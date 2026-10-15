package com.marystig.vidafoodcaisse.print

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Base64
import android.util.Log
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/**
 * Classic SPP (RFCOMM) ESC/POS sender — persistent session.
 *
 * Key change vs. previous version:
 *   • After a successful print the RFCOMM socket is kept OPEN.
 *   • The next ticket reuses the live socket (0 ms connection overhead).
 *   • On failure the session is closed and ONE clean reconnect is tried.
 *   • Per-attempt timeout reduced 15 s → 8 s so worst-case first connection
 *     goes from ~30 s (2 × 15 s) to ~16 s (2 × 8 s).
 *   • On reconnect the code remembers which connection method (SPP UUID or
 *     channel 1) worked last and tries that first.
 */
class EscPosBluetoothPrinter {
  companion object {
    private const val TAG = "EscPosBt"
    private val SPP_UUID: UUID =
      UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** Single-printer profile — keep in sync with JS kitchenPrintQueue. */
    const val OP_TIMEOUT_MS        = 8_000L   // reduced from 15 s → 8 s
    const val HARD_SETTLE_MS       = 700L
    const val PRE_DISCONNECT_DRAIN_MS = 175L
    const val INTER_PRINTER_GAP_MS = 350L
    const val RECEIPT_MAC_COOLDOWN_MS = 350L

    /** Close persistent session after this many ms of inactivity. */
    private const val SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1_000L   // 5 min
  }

  // ── Persistent session ──────────────────────────────────────────────────────
  private val sessionLock = Any()
  /** Active RFCOMM socket, kept open between prints. Guarded by sessionLock. */
  private var sessionSocket: BluetoothSocket? = null
  /** Normalised MAC of the current session. Guarded by sessionLock. */
  private var sessionMac: String? = null
  /** Timestamp of last successful send. Guarded by sessionLock. */
  private var sessionLastActivityMs: Long = 0L
  /**
   * true  = SPP UUID succeeded last time (try it first on reconnect).
   * false = channel-1 fallback succeeded.
   */
  private var sessionUsedSppUuid: Boolean = true

  @Volatile private var radioNeedsSettle = false
  private val lastSuccessMacRef = AtomicReference<String?>(null)

  // ── Public session helpers ──────────────────────────────────────────────────

  /**
   * True when there is a live, connected RFCOMM session for the given MAC
   * that has not been idle for more than SESSION_IDLE_TIMEOUT_MS.
   */
  fun hasLiveSession(mac: String): Boolean {
    val normalised = normalizeMac(mac)
    synchronized(sessionLock) {
      val sock = sessionSocket ?: return false
      if (sessionMac != normalised) return false
      if (!sock.isConnected) return false
      val idleMs = System.currentTimeMillis() - sessionLastActivityMs
      if (idleMs > SESSION_IDLE_TIMEOUT_MS) return false
      return true
    }
  }

  /**
   * Close and discard the persistent session. Always safe to call.
   * Sets radioNeedsSettle so the next connect does a full hard-settle.
   */
  fun closeSession(reason: String) {
    synchronized(sessionLock) {
      Log.i(TAG, "[PRINT TRACE] t=${System.currentTimeMillis()} event=session_close reason=$reason")
      try { sessionSocket?.close() } catch (_: Exception) { /* ignore */ }
      sessionSocket = null
      sessionMac = null
    }
    radioNeedsSettle = true
  }

  /** Alias used by PrintWorkerLoop.start() / stop(). */
  fun forceClose(reason: String) = closeSession(reason)

  /** Close session + sleep HARD_SETTLE_MS to let the radio recover. */
  fun hardSettle(reason: String) {
    closeSession(reason)
    Log.i(TAG, "settle ${HARD_SETTLE_MS}ms · $reason")
    Thread.sleep(HARD_SETTLE_MS)
  }

  // ── Main send entry-point ───────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  fun sendEscPos(
    printerName: String,
    macAddress: String,
    dataBase64: String,
    isReceipt: Boolean,
  ) {
    val mac = normalizeMac(macAddress)
    if (mac.isBlank()) throw IOException("Adresse MAC manquante")

    @Suppress("DEPRECATION")
    val adapter = BluetoothAdapter.getDefaultAdapter()
      ?: throw IOException("Bluetooth non disponible")
    if (!adapter.isEnabled) {
      throw IOException("Le Bluetooth est désactivé sur la tablette !")
    }

    val raw = Base64.decode(dataBase64, Base64.DEFAULT)
    if (raw.isEmpty()) throw IOException("Payload ESC/POS vide")

    val t0 = System.currentTimeMillis()
    val maskedMac = "**:**:**:**:${mac.takeLast(5)}"
    Log.i(TAG, "[PRINT TRACE] t=$t0 event=bt_send_start printer=$printerName mac=$maskedMac isReceipt=$isReceipt")

    // Acquire (or reuse) the RFCOMM socket
    val socket = acquireSocket(mac, printerName, isReceipt, adapter)

    val tAcquired = System.currentTimeMillis()
    Log.i(TAG, "[PRINT TRACE] t=$tAcquired dt=${tAcquired - t0}ms event=socket_ready printer=$printerName")

    try {
      val out = socket.outputStream
      val tSend0 = System.currentTimeMillis()
      Log.i(TAG, "[PRINT TRACE] t=$tSend0 event=send_start printer=$printerName bytes=${raw.size}")
      out.write(raw)
      out.flush()
      val tSendDone = System.currentTimeMillis()
      Log.i(TAG, "SEND COMPLETE · $printerName · bytes=${raw.size}")
      Log.i(TAG, "[PRINT TRACE] t=$tSendDone dt=${tSendDone - tSend0}ms event=send_complete printer=$printerName bytes=${raw.size}")

      if (!isReceipt) {
        // Allow the thermal head to drain before we attempt the next socket op.
        Thread.sleep(PRE_DISCONNECT_DRAIN_MS)
      }

      // ── Keep session alive — do NOT close the socket ──────────────────────
      synchronized(sessionLock) {
        sessionLastActivityMs = System.currentTimeMillis()
      }
      lastSuccessMacRef.set(mac)
      radioNeedsSettle = false
      Log.i(TAG, "[PRINT TRACE] t=${System.currentTimeMillis()} dt_total=${System.currentTimeMillis() - t0}ms event=session_kept printer=$printerName")

    } catch (e: Exception) {
      // Send failed — tear down so the next ticket reconnects cleanly.
      closeSession("send-fail:$printerName")
      throw e
    }
  }

  // ── Socket acquisition (reuse or fresh connect) ────────────────────────────

  @SuppressLint("MissingPermission")
  private fun acquireSocket(
    mac: String,
    printerName: String,
    isReceipt: Boolean,
    adapter: BluetoothAdapter,
  ): BluetoothSocket {
    // 1. Try to reuse the live session
    synchronized(sessionLock) {
      val existing = sessionSocket
      if (existing != null && existing.isConnected && sessionMac == mac) {
        val idleMs = System.currentTimeMillis() - sessionLastActivityMs
        if (idleMs <= SESSION_IDLE_TIMEOUT_MS) {
          Log.i(TAG, "[PRINT TRACE] t=${System.currentTimeMillis()} event=session_reused printer=$printerName idleMs=${idleMs}ms")
          return existing
        }
        // Session idle too long — close it and reconnect below.
        Log.i(TAG, "[PRINT TRACE] t=${System.currentTimeMillis()} event=session_expired idleMs=${idleMs}ms printer=$printerName")
        try { existing.close() } catch (_: Exception) { /* ignore */ }
        sessionSocket = null
        sessionMac = null
      }
    }

    // 2. Need a fresh connection
    applyMacCooldown(mac, isReceipt)

    if (radioNeedsSettle) {
      val tSettle0 = System.currentTimeMillis()
      Log.i(TAG, "[PRINT TRACE] t=$tSettle0 event=hard_settle_start printer=$printerName")
      hardSettle("pre-connect:$printerName")
      Log.i(TAG, "[PRINT TRACE] t=${System.currentTimeMillis()} dt=${System.currentTimeMillis() - tSettle0}ms event=hard_settle_done printer=$printerName")
    } else {
      // Minimal inter-print gap — enough for the radio to be idle.
      Thread.sleep(50)
    }

    val device: BluetoothDevice = try {
      resolveBondedDevice(adapter, mac)
    } catch (e: IllegalArgumentException) {
      throw IOException("MAC invalide: $mac", e)
    }

    val tConnect0 = System.currentTimeMillis()
    val maskedMac = "**:**:**:**:${mac.takeLast(5)}"
    Log.i(TAG, "[PRINT TRACE] t=$tConnect0 event=connect_start printer=$printerName mac=$maskedMac")
    Log.i(TAG, "CONNECT START · $printerName · $mac")

    val (socket, usedSppUuid) = connectWithBestMethod(device, printerName)

    val tConnected = System.currentTimeMillis()
    Log.i(TAG, "[PRINT TRACE] t=$tConnected dt=${tConnected - tConnect0}ms event=connected printer=$printerName usedSppUuid=$usedSppUuid")
    Log.i(TAG, "CONNECTED · $printerName")

    synchronized(sessionLock) {
      sessionSocket = socket
      sessionMac = mac
      sessionLastActivityMs = System.currentTimeMillis()
      sessionUsedSppUuid = usedSppUuid
    }
    radioNeedsSettle = false

    return socket
  }

  // ── Connection strategy: remember what worked last ─────────────────────────

  @SuppressLint("MissingPermission")
  private fun connectWithBestMethod(
    device: BluetoothDevice,
    printerName: String,
  ): Pair<BluetoothSocket, Boolean> {
    @Suppress("DEPRECATION")
    val adapter = BluetoothAdapter.getDefaultAdapter()
    try { adapter?.cancelDiscovery() } catch (_: Exception) { /* ignore */ }

    // On reconnect, try the method that succeeded last to avoid the 8-s wait.
    return if (sessionUsedSppUuid) {
      tryConnectSppUuid(device, printerName)
        ?: tryConnectChannel1(device, printerName)
        ?: throw IOException("Connexion impossible ($printerName) — SPP UUID et channel-1 ont échoué")
    } else {
      tryConnectChannel1(device, printerName)
        ?: tryConnectSppUuid(device, printerName)
        ?: throw IOException("Connexion impossible ($printerName) — channel-1 et SPP UUID ont échoué")
    }
  }

  /** Returns (socket, true) on success, null on failure. */
  private fun tryConnectSppUuid(
    device: BluetoothDevice,
    printerName: String,
  ): Pair<BluetoothSocket, Boolean>? {
    val socket = try {
      device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
    } catch (_: Exception) {
      return try {
        val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
        connectWithTimeout(s, OP_TIMEOUT_MS)
        s to true
      } catch (e: Exception) {
        Log.w(TAG, "SPP UUID (secure) failed · $printerName: ${e.message}")
        null
      }
    }
    return try {
      connectWithTimeout(socket, OP_TIMEOUT_MS)
      socket to true
    } catch (e: IOException) {
      Log.w(TAG, "SPP UUID failed · $printerName: ${e.message}")
      try { socket.close() } catch (_: Exception) { /* ignore */ }
      null
    }
  }

  /** Returns (socket, false) on success, null on failure. */
  @Suppress("UNCHECKED_CAST")
  private fun tryConnectChannel1(
    device: BluetoothDevice,
    printerName: String,
  ): Pair<BluetoothSocket, Boolean>? {
    val socket = try {
      device.javaClass
        .getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType)
        .invoke(device, 1) as BluetoothSocket
    } catch (_: Exception) {
      return try {
        val s = device.javaClass
          .getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          .invoke(device, 1) as BluetoothSocket
        connectWithTimeout(s, OP_TIMEOUT_MS)
        s to false
      } catch (e: Exception) {
        Log.w(TAG, "channel-1 (secure) failed · $printerName: ${e.message}")
        null
      }
    }
    return try {
      connectWithTimeout(socket, OP_TIMEOUT_MS)
      Log.i(TAG, "CONNECTED channel1 · $printerName")
      socket to false
    } catch (e: IOException) {
      Log.w(TAG, "channel-1 failed · $printerName: ${e.message}")
      try { socket.close() } catch (_: Exception) { /* ignore */ }
      null
    }
  }

  // ── Probe (admin only — closes session explicitly after) ───────────────────

  @SuppressLint("MissingPermission")
  fun probeConnect(printerName: String, macAddress: String) {
    val mac = normalizeMac(macAddress)
    @Suppress("DEPRECATION")
    val adapter = BluetoothAdapter.getDefaultAdapter()
      ?: throw IOException("Bluetooth non disponible")
    if (!adapter.isEnabled) throw IOException("Bluetooth désactivé")
    applyMacCooldown(mac, isReceipt = false)
    hardSettle("probe:$printerName")
    val device = resolveBondedDevice(adapter, mac)
    val (socket, _) = connectWithBestMethod(device, printerName)
    try {
      lastSuccessMacRef.set(mac)
      radioNeedsSettle = false
    } finally {
      try { socket.close() } catch (_: Exception) { /* ignore */ }
      // Close session too — probe must not leave a dangling session
      closeSession("probe-done:$printerName")
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private fun normalizeMac(mac: String): String =
    mac.trim().uppercase().replace('-', ':')

  private fun applyMacCooldown(nextMac: String, isReceipt: Boolean) {
    val prev = lastSuccessMacRef.get()?.let { normalizeMac(it) }
    val next = normalizeMac(nextMac)
    if (prev.isNullOrBlank() || prev == next) return
    val gap = if (isReceipt) RECEIPT_MAC_COOLDOWN_MS else INTER_PRINTER_GAP_MS
    Log.i(TAG, "MAC cooldown ${gap}ms · $prev → $next")
    Thread.sleep(gap)
  }

  @SuppressLint("MissingPermission")
  private fun resolveBondedDevice(adapter: BluetoothAdapter, mac: String): BluetoothDevice {
    val bonded = adapter.bondedDevices?.firstOrNull { it.address.equals(mac, ignoreCase = true) }
    return bonded ?: adapter.getRemoteDevice(mac)
  }

  private fun connectWithTimeout(socket: BluetoothSocket, timeoutMs: Long) {
    val err = AtomicReference<Exception?>(null)
    val t = Thread({
      try {
        socket.connect()
      } catch (e: Exception) {
        err.set(e)
      }
    }, "EscPosConnect")
    t.isDaemon = true
    t.start()
    t.join(timeoutMs)
    if (t.isAlive) {
      try { socket.close() } catch (_: Exception) { /* ignore */ }
      t.interrupt()
      try { t.join(1_000) } catch (_: Exception) { /* ignore */ }
      throw IOException("Délai d'attente dépassé pour la connexion (${timeoutMs / 1000}s)")
    }
    err.get()?.let { e ->
      throw IOException("Connexion impossible (Vérifiez l'imprimante): ${e.message}", e)
    }
    if (!socket.isConnected) {
      throw IOException("Connexion impossible — socket non connecté")
    }
  }
}
