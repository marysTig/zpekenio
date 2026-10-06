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
 * Classic SPP (RFCOMM) ESC/POS sender — connect → write → drain → disconnect.
 * One socket at a time (single radio). Tuned for single Caisse printer.
 */
class EscPosBluetoothPrinter {
  companion object {
    private const val TAG = "EscPosBt"
    private val SPP_UUID: UUID =
      UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** Single-printer profile — keep in sync with JS bluetoothRadio / kitchenPrintQueue. */
    const val OP_TIMEOUT_MS = 15_000L
    const val HARD_SETTLE_MS = 700L
    const val PRE_DISCONNECT_DRAIN_MS = 175L
    const val INTER_PRINTER_GAP_MS = 350L
    const val RECEIPT_MAC_COOLDOWN_MS = 350L
  }

  private val socketRef = AtomicReference<BluetoothSocket?>(null)
  @Volatile private var lastSuccessMac: String? = null
  @Volatile private var radioNeedsSettle = false

  fun forceClose(reason: String) {
    Log.i(TAG, "forceClose · $reason")
    radioNeedsSettle = true
    try {
      socketRef.getAndSet(null)?.close()
    } catch (_: Exception) {
      /* ignore */
    }
  }

  fun hardSettle(reason: String) {
    forceClose(reason)
    Log.i(TAG, "settle ${HARD_SETTLE_MS}ms · $reason")
    Thread.sleep(HARD_SETTLE_MS)
  }

  private fun normalizeMac(mac: String): String =
    mac.trim().uppercase().replace('-', ':')

  private fun applyMacCooldown(nextMac: String, isReceipt: Boolean) {
    val prev = lastSuccessMac?.let { normalizeMac(it) }
    val next = normalizeMac(nextMac)
    if (prev.isNullOrBlank() || prev == next) return
    val gap = if (isReceipt) RECEIPT_MAC_COOLDOWN_MS else INTER_PRINTER_GAP_MS
    Log.i(TAG, "MAC cooldown ${gap}ms · $prev → $next")
    Thread.sleep(gap)
  }

  @SuppressLint("MissingPermission")
  fun sendEscPos(
    printerName: String,
    macAddress: String,
    dataBase64: String,
    isReceipt: Boolean,
  ) {
    val mac = normalizeMac(macAddress)
    if (mac.isBlank()) throw IOException("Adresse MAC manquante")

    val adapter = BluetoothAdapter.getDefaultAdapter()
      ?: throw IOException("Bluetooth non disponible")
    if (!adapter.isEnabled) {
      throw IOException("Le Bluetooth est désactivé sur la tablette !")
    }

    applyMacCooldown(mac, isReceipt)
    if (radioNeedsSettle) {
      hardSettle("pre-connect:$printerName")
    } else {
      // Soft close only — do not mark settle-needed for a clean handoff.
      try {
        socketRef.getAndSet(null)?.close()
      } catch (_: Exception) {
        /* ignore */
      }
      Thread.sleep(100)
    }

    val raw = Base64.decode(dataBase64, Base64.DEFAULT)
    if (raw.isEmpty()) throw IOException("Payload ESC/POS vide")

    val device: BluetoothDevice = try {
      resolveBondedDevice(adapter, mac)
    } catch (e: IllegalArgumentException) {
      throw IOException("MAC invalide: $mac", e)
    }

    Log.i(TAG, "CONNECT START · $printerName · $mac")
    val socket = connectEscPos(device, printerName)
    socketRef.set(socket)

    try {
      Log.i(TAG, "CONNECTED · $printerName")
      val out = socket.outputStream
      out.write(raw)
      out.flush()
      Log.i(TAG, "SEND COMPLETE · $printerName · bytes=${raw.size}")
      if (!isReceipt) {
        Thread.sleep(PRE_DISCONNECT_DRAIN_MS)
      }
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
        /* ignore */
      }
      socketRef.compareAndSet(socket, null)
      Log.i(TAG, "DISCONNECTED · $printerName")
    }

    lastSuccessMac = mac
    radioNeedsSettle = false
  }

  @SuppressLint("MissingPermission")
  fun probeConnect(printerName: String, macAddress: String) {
    val mac = normalizeMac(macAddress)
    val adapter = BluetoothAdapter.getDefaultAdapter()
      ?: throw IOException("Bluetooth non disponible")
    if (!adapter.isEnabled) {
      throw IOException("Bluetooth désactivé")
    }
    applyMacCooldown(mac, isReceipt = false)
    hardSettle("probe:$printerName")
    val device = resolveBondedDevice(adapter, mac)
    val socket = connectEscPos(device, printerName)
    socketRef.set(socket)
    try {
      lastSuccessMac = mac
      radioNeedsSettle = false
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
        /* ignore */
      }
      socketRef.compareAndSet(socket, null)
      hardSettle("probe-done:$printerName")
    }
  }

  @SuppressLint("MissingPermission")
  private fun resolveBondedDevice(adapter: BluetoothAdapter, mac: String): BluetoothDevice {
    val bonded = adapter.bondedDevices?.firstOrNull { it.address.equals(mac, ignoreCase = true) }
    return bonded ?: adapter.getRemoteDevice(mac)
  }

  /** Insecure SPP UUID then insecure channel-1 — same as cordova bluetooth-serial. */
  @SuppressLint("MissingPermission")
  private fun connectEscPos(device: BluetoothDevice, printerName: String): BluetoothSocket {
    val adapter = BluetoothAdapter.getDefaultAdapter()
    try {
      adapter?.cancelDiscovery()
    } catch (_: Exception) {
      /* ignore */
    }

    val primary =
      try {
        device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
      } catch (_: Exception) {
        device.createRfcommSocketToServiceRecord(SPP_UUID)
      }
    socketRef.set(primary)
    try {
      connectWithTimeout(primary, OP_TIMEOUT_MS)
      return primary
    } catch (first: IOException) {
      Log.w(TAG, "SPP UUID failed · $printerName — trying channel 1", first)
      try {
        primary.close()
      } catch (_: Exception) {
        /* ignore */
      }
      socketRef.compareAndSet(primary, null)
    }

    val fallback =
      try {
        device.javaClass
          .getMethod("createInsecureRfcommSocket", Int::class.javaPrimitiveType)
          .invoke(device, 1) as BluetoothSocket
      } catch (_: Exception) {
        device.javaClass
          .getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          .invoke(device, 1) as BluetoothSocket
      }
    socketRef.set(fallback)
    try {
      connectWithTimeout(fallback, OP_TIMEOUT_MS)
      Log.i(TAG, "CONNECTED channel1 · $printerName")
      return fallback
    } catch (second: IOException) {
      try {
        fallback.close()
      } catch (_: Exception) {
        /* ignore */
      }
      socketRef.compareAndSet(fallback, null)
      throw second
    }
  }

  @SuppressLint("MissingPermission")
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
      try {
        socket.close()
      } catch (_: Exception) {
        /* ignore */
      }
      t.interrupt()
      try {
        t.join(1_000)
      } catch (_: Exception) {
        /* ignore */
      }
      throw IOException(
        "Délai d'attente dépassé pour la connexion (${timeoutMs / 1000}s)",
      )
    }
    err.get()?.let { e ->
      throw IOException(
        "Connexion impossible (Vérifiez l'imprimante): ${e.message}",
        e,
      )
    }
    if (!socket.isConnected) {
      throw IOException("Connexion impossible — socket non connecté")
    }
  }
}
