package com.marystig.vidafoodcaisse.print

import android.util.Log
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Single-thread FIFO drain: claim → RFCOMM print → done/retry.
 * Admin BT ops are drained inside the loop (same thread) so they never
 * queue behind the forever-running loop task.
 */
class PrintWorkerLoop(
  private val repo: PrintJobRepository,
  private val printer: EscPosBluetoothPrinter,
  private val onStatus: (running: Boolean, queueDepth: Int, lastError: String?) -> Unit,
) {
  companion object {
    private const val TAG = "PrintWorkerLoop"
    /** Single-printer profile — snappy claim between jobs; Realtime wake covers idle. */
    private const val POLL_BUSY_MS = 120L
    private const val POLL_IDLE_MS = 450L
    private const val WORKER_THREAD = "HubPrintWorker"
  }

  private val running = AtomicBoolean(false)
  private val wake = AtomicBoolean(false)
  private val lastError = AtomicReference<String?>(null)
  private var executor: ExecutorService? = null
  private val adminQueue = LinkedBlockingQueue<() -> Unit>()

  fun isRunning(): Boolean = running.get()

  fun getLastError(): String? = lastError.get()

  fun wake() {
    wake.set(true)
  }

  fun start() {
    if (!running.compareAndSet(false, true)) return
    printer.forceClose("loop-start")
    val exec = Executors.newSingleThreadExecutor { r ->
      Thread(r, "HubPrintWorker").apply { isDaemon = true }
    }
    executor = exec
    // Network + reclaim must not run on the main thread (startup DNS race).
    exec.execute {
      try {
        repo.reclaimPrintingForDevice()
        onStatus(true, repo.countActiveJobs(), null)
      } catch (e: Exception) {
        Log.w(TAG, "startup reclaim failed", e)
      }
      loop()
    }
    onStatus(true, 0, null)
    Log.i(TAG, "started")
  }

  fun stop() {
    running.set(false)
    wake.set(true)
    executor?.shutdownNow()
    executor = null
    printer.forceClose("loop-stop")
    onStatus(false, 0, lastError.get())
    Log.i(TAG, "stopped")
  }

  fun triggerManualRetry() {
    runOnExecutor {
      try {
        val n = repo.retryAllNeedsManual()
        Log.i(TAG, "manual retry enqueued $n")
        wake()
      } catch (e: Exception) {
        lastError.set(e.message)
        Log.w(TAG, "manual retry failed", e)
      }
    }
  }

  /** Run Admin probe on the same thread as production prints. */
  fun adminProbe(printerName: String, mac: String): Pair<Boolean, String> {
    return runOnExecutorBlocking {
      try {
        if (repo.countActiveJobs() > 0) {
          return@runOnExecutorBlocking false to "File d'impression active — probe différé"
        }
        printer.probeConnect(printerName, mac)
        true to "Joignable (ping OK)"
      } catch (e: Exception) {
        false to (e.message ?: "Erreur probe")
      }
    }
  }

  fun adminTestPrint(printerName: String, mac: String, escposBase64: String): Pair<Boolean, String> {
    return runOnExecutorBlocking {
      try {
        printer.sendEscPos(printerName, mac, escposBase64, isReceipt = true)
        true to "OK"
      } catch (e: Exception) {
        printer.hardSettle("admin-test-fail")
        false to (e.message ?: "Erreur impression test")
      }
    }
  }

  private fun runOnExecutor(block: () -> Unit) {
    if (Thread.currentThread().name == WORKER_THREAD) {
      block()
      return
    }
    adminQueue.offer(block)
    wake()
  }

  private fun <T> runOnExecutorBlocking(block: () -> T): T {
    if (Thread.currentThread().name == WORKER_THREAD) return block()
    val latch = CountDownLatch(1)
    val result = AtomicReference<Any?>()
    val error = AtomicReference<Exception?>()
    adminQueue.offer {
      try {
        result.set(block())
      } catch (e: Exception) {
        error.set(e)
      } finally {
        latch.countDown()
      }
    }
    wake()
    if (!latch.await(90, TimeUnit.SECONDS)) {
      throw IOException("Admin BT op timeout — worker busy")
    }
    error.get()?.let { throw it }
    @Suppress("UNCHECKED_CAST")
    return result.get() as T
  }

  private fun drainAdminOps() {
    while (true) {
      val op = adminQueue.poll() ?: break
      try {
        op()
      } catch (e: Exception) {
        Log.w(TAG, "admin op failed", e)
      }
    }
  }

  private fun loop() {
    while (running.get()) {
      try {
        drainAdminOps()
        repo.reclaimStalePrinting()
        val job = repo.claimNext()
        if (job == null) {
          onStatus(true, 0, lastError.get())
          sleepInterruptible(POLL_IDLE_MS)
          continue
        }
        onStatus(true, repo.countActiveJobs() + 1, lastError.get())
        processJob(job)
        drainAdminOps()
        sleepInterruptible(POLL_BUSY_MS)
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        break
      } catch (e: Exception) {
        Log.e(TAG, "drain error", e)
        lastError.set(e.message)
        onStatus(true, repo.countActiveJobs(), e.message)
        sleepInterruptible(2000)
      }
    }
  }

  private fun processJob(job: NativePrintJob) {
    val name = job.printerName ?: "imprimante"
    val mac = job.macAddress
    val b64 = job.escposBase64
    Log.i(TAG, "PRINT START · ${job.jobType} → $name")

    // Receipts-only: cancel leftover kitchen jobs without Bluetooth I/O
    if (job.jobType != "receipt") {
      Log.i(TAG, "cancel legacy kitchen job ${job.id}")
      repo.cancelJob(job.id, "Cuisine désactivée — ticket ignoré")
      return
    }

    if (mac.isNullOrBlank() || b64.isNullOrBlank()) {
      repo.scheduleRetry(job.id, 99, "Payload ou MAC manquant", 0)
      lastError.set("Payload ou MAC manquant")
      return
    }

    try {
      repo.heartbeat(job.id)
      printer.sendEscPos(name, mac, b64, isReceipt = true)
      repo.markDone(job.id)
      lastError.set(null)
      Log.i(TAG, "PRINT END OK · $name")
    } catch (e: Exception) {
      val msg = e.message ?: "Erreur impression"
      Log.e(TAG, "PRINT FAIL · $name · $msg", e)
      lastError.set(msg)
      try {
        printer.hardSettle("job-fail:$name")
      } catch (_: Exception) {
        /* ignore */
      }
      val nextAttempt = job.attemptCount + 1
      repo.scheduleRetry(
        job.id,
        nextAttempt,
        msg,
        PrintJobRepository.RECEIPT_RETRY_BACKOFF_MS,
      )
    }
  }

  private fun sleepInterruptible(ms: Long) {
    val end = System.currentTimeMillis() + ms
    while (running.get() && System.currentTimeMillis() < end) {
      if (wake.compareAndSet(true, false)) return
      try {
        Thread.sleep(100)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        return
      }
    }
  }
}
