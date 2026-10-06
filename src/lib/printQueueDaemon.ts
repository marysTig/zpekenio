/**
 * PrintQueueDaemon — single-flight Bluetooth drain for Caisse receipts.
 * Single-printer profile; MAC cooldown via bluetoothCoordinator; watchdog self-heal.
 */

import { toast } from "sonner";
import {
  forceResetRadioState,
  getLastIoProgressAt,
  hardSettleRadio,
  markRadioNeedsSettle,
  sleep,
  touchIoProgress,
  BT_OP_TIMEOUT_MS,
} from "@/lib/bluetoothRadio";
import { runProductionReceipt } from "@/lib/bluetoothCoordinator";
import { base64ToUint8 } from "@/lib/escposTickets";
import {
  cancelLegacyKitchenJobs,
  claimNextPrintJob,
  markPrintJobDone,
  reclaimPrintingJobsForThisDevice,
  reclaimStalePrintingJobs,
  requeueInterruptedJob,
  schedulePrintJobRetry,
  RECEIPT_RETRY_BACKOFF_MS,
  type PrintJob,
} from "@/lib/kitchenPrintQueue";
import { getLocalPrintDeviceId } from "@/lib/printDevice";
import { isLocalDevicePrimaryHub } from "@/lib/printSettingsStore";
import { logPrintActivity, updatePrintActivity } from "@/lib/printActivityLog";
import {
  isNativePrintWorkerActive,
  wakeNativePrintWorker,
} from "@/lib/hubPrintWorkerPlugin";

/** Stall budget = connect/write timeout + margin before force-reset. */
export const WATCHDOG_MARGIN_MS = 5000;
const WATCHDOG_POLL_MS = 1000;

let draining = false;
let wakeDrain: (() => void) | null = null;
/** Ensures only one drain loop exists (React remount / hub flip). */
let stopActiveDaemon: (() => void) | null = null;

function notifyDrain() {
  wakeDrain?.();
}

/** Called when a new pending job arrives (realtime). */
export function wakePrintQueueDaemon() {
  if (isNativePrintWorkerActive()) {
    void wakeNativePrintWorker();
    return;
  }
  notifyDrain();
}

async function sendJobBytes(job: PrintJob, data: Uint8Array): Promise<"ok"> {
  const mac = (job.mac_address ?? "").trim();
  const name = job.printer_name ?? "imprimante";
  if (!mac) throw new Error("Adresse MAC manquante");

  await runProductionReceipt({
    jobId: job.id,
    printerName: name,
    macAddress: mac,
    data,
  });
  return "ok";
}

/**
 * Run sendJobBytes with a watchdog: if no I/O progress for
 * BT_OP_TIMEOUT_MS + margin, force-reset radio and requeue without attempt++.
 */
async function sendJobBytesWithWatchdog(
  job: PrintJob,
  data: Uint8Array,
): Promise<"ok" | "watchdog"> {
  touchIoProgress(`job-start:${job.id}`);
  let settled = false;
  let watchdogFired = false;

  const watchdog = (async () => {
    while (!settled) {
      await sleep(WATCHDOG_POLL_MS);
      if (settled) return;
      const last = getLastIoProgressAt();
      const idleFor = Date.now() - (last || Date.now());
      if (idleFor > BT_OP_TIMEOUT_MS + WATCHDOG_MARGIN_MS) {
        watchdogFired = true;
        console.error(
          `[PRINT DAEMON] WATCHDOG · job ${job.id} · idle ${idleFor}ms · ${job.printer_name}`,
        );
        try {
          await forceResetRadioState(`watchdog:${job.id}`);
        } catch (e) {
          console.warn("[PRINT DAEMON] watchdog reset failed", e);
        }
        return;
      }
    }
  })();

  try {
    await sendJobBytes(job, data);
    settled = true;
    await watchdog;
    if (watchdogFired) return "watchdog";
    return "ok";
  } catch (err) {
    settled = true;
    await watchdog;
    if (watchdogFired) return "watchdog";
    throw err;
  }
}

async function processJob(job: PrintJob): Promise<void> {
  if (job.job_type !== "receipt") {
    await cancelLegacyKitchenJobs();
    return;
  }

  const b64 = job.payload?.escposBase64;
  if (!b64) {
    await schedulePrintJobRetry(job.id, MAX_ATTEMPTS_FORCE, "Payload ESC/POS manquant");
    return;
  }

  const data = base64ToUint8(b64);
  const activityId = logPrintActivity({
    kind: "caisse",
    printerName: job.printer_name ?? "?",
    mac: job.mac_address,
    status: "started",
    detail: `receipt · ${job.payload.orderLabel}`,
  });

  console.log(
    `[PRINT DAEMON] receipt → ${job.printer_name} (attempt ${job.attempt_count + 1})`,
  );
  console.log(`[PRINT START] ${job.printer_name}`);

  try {
    const result = await sendJobBytesWithWatchdog(job, data);
    if (result === "watchdog") {
      updatePrintActivity(activityId, {
        status: "error",
        detail: "Watchdog — radio réinitialisée",
      });
      await requeueInterruptedJob(job.id);
      console.log(`[PRINT DAEMON] Requeued after watchdog ${job.id}`);
      await sleep(2000);
      wakePrintQueueDaemon();
      return;
    }

    await markPrintJobDone(job.id);
    updatePrintActivity(activityId, { status: "success", detail: "OK" });
    console.log(`[PRINT END] ${job.printer_name}`);
    console.log(`[PRINT DAEMON] Done ${job.id}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PRINT DAEMON] Fail ${job.id}:`, message);
    updatePrintActivity(activityId, { status: "error", detail: message });
    try {
      await hardSettleRadio(`job-fail:${job.printer_name}`);
    } catch {
      /* ignore */
    }

    const nextAttempt = (job.attempt_count ?? 0) + 1;
    const outcome = await schedulePrintJobRetry(
      job.id,
      nextAttempt,
      message,
      RECEIPT_RETRY_BACKOFF_MS,
    );
    if (outcome === "needs_manual") {
      toast.error("Ticket non imprimé", {
        description: `${job.printer_name ?? "Imprimante"}: ${message}`,
        duration: 6000,
      });
    }
    console.log(`[PRINT END] ${job.printer_name}`);
  }
}

const MAX_ATTEMPTS_FORCE = 99;

/**
 * Single-flight drain loop. Call startPrintQueueDaemon once on primary hub.
 * Safe to call again — stops any previous loop first.
 */
export function startPrintQueueDaemon(): () => void {
  stopActiveDaemon?.();

  let stopped = false;
  let waitResolve: (() => void) | null = null;
  /** Set when wake arrives before waitForWake — prevents lost-wakeup (~1s caisse lag). */
  let pendingWake = false;

  wakeDrain = () => {
    pendingWake = true;
    if (waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;
      pendingWake = false;
      resolve();
    }
  };

  const waitForWake = (ms: number) =>
    new Promise<void>((resolve) => {
      if (pendingWake) {
        pendingWake = false;
        resolve();
        return;
      }
      waitResolve = resolve;
      setTimeout(() => {
        if (waitResolve === resolve) {
          waitResolve = null;
          resolve();
        }
      }, ms);
    });

  const loop = async () => {
    console.log("[PRINT DAEMON] Started");
    let radioBootstrapped = false;
    while (!stopped) {
      if (!isLocalDevicePrimaryHub()) {
        await waitForWake(200);
        continue;
      }
      if (isNativePrintWorkerActive()) {
        await waitForWake(2000);
        continue;
      }
      if (typeof window === "undefined" || !window.bluetoothSerial) {
        await waitForWake(5000);
        continue;
      }

      if (draining) {
        await waitForWake(200);
        continue;
      }

      draining = true;
      try {
        if (!radioBootstrapped) {
          radioBootstrapped = true;
          markRadioNeedsSettle("daemon-start");
          try {
            await hardSettleRadio("daemon-start");
          } catch {
            /* ignore */
          }
          if (isNativePrintWorkerActive()) continue;
          await cancelLegacyKitchenJobs();
          await reclaimPrintingJobsForThisDevice(getLocalPrintDeviceId());
        }
        if (isNativePrintWorkerActive()) continue;
        await reclaimStalePrintingJobs(getLocalPrintDeviceId());

        while (
          !stopped &&
          isLocalDevicePrimaryHub() &&
          !isNativePrintWorkerActive()
        ) {
          const job = await claimNextPrintJob();
          if (!job) break;
          if (isNativePrintWorkerActive()) {
            await requeueInterruptedJob(job.id);
            break;
          }
          await processJob(job);
        }
      } catch (e) {
        console.error("[PRINT DAEMON] drain error", e);
      } finally {
        draining = false;
      }

      await waitForWake(1000);
    }
    console.log("[PRINT DAEMON] Stopped");
  };

  void loop();

  const stop = () => {
    stopped = true;
    if (stopActiveDaemon === stop) stopActiveDaemon = null;
    wakeDrain = null;
    waitResolve?.();
  };
  stopActiveDaemon = stop;
  return stop;
}
