import { useEffect } from "react";
import { RealtimeManager, type PostgresPayload } from "@/lib/realtimeManager";
import { getLocalPrintDeviceId } from "@/lib/printDevice";
import {
  isLocalDevicePrimaryHub,
  usePrintSettingsStore,
} from "@/lib/printSettingsStore";
import {
  startPrintQueueDaemon,
  wakePrintQueueDaemon,
} from "@/lib/printQueueDaemon";
import { scheduleHubAutoBluetoothProbe } from "@/lib/printerProbe";
import {
  isNativePrintWorkerActive,
  startNativePrintWorker,
  wakeNativePrintWorker,
} from "@/lib/hubPrintWorkerPlugin";

let _daemonManager: RealtimeManager | null = null;

export function getPrintQueueRealtimeManager(): RealtimeManager | null {
  return _daemonManager;
}

/** @deprecated alias for Admin / older imports */
export function getKitchenPrintRealtimeManager(): RealtimeManager | null {
  return _daemonManager;
}

/**
 * Mounts the PrintQueueDaemon drain loop on every device after settings load.
 * The loop itself no-ops until this device is the primary hub — so a late
 * hub claim still starts printing without requiring a full app restart.
 */
export function PrintQueueDaemon() {
  const { isPrimaryHub, loading, primaryDeviceId } = usePrintSettingsStore();

  useEffect(() => {
    if (loading) {
      console.log("[PRINT DAEMON] Waiting for print_settings…");
      return;
    }

    const deviceId = getLocalPrintDeviceId();
    console.log("[PRINT DAEMON] Settings ready", {
      deviceId,
      primaryDeviceId: primaryDeviceId || "(none)",
      isPrimaryHub,
    });

    let cancelled = false;
    let stopDaemon: (() => void) | null = null;
    let cancelAutoProbe: (() => void) | null = null;
    let manager: RealtimeManager | null = null;

    void (async () => {
      // Start native first when hub so JS never wins the radio race.
      if (isPrimaryHub) {
        console.log("[PRINT DAEMON] Mount primary hub:", deviceId);
        const ok = await startNativePrintWorker();
        if (cancelled) return;
        console.log(
          ok
            ? "[PRINT DAEMON] Native worker active — JS BT drain idle"
            : "[PRINT DAEMON] Native worker unavailable — Phase 0 JS drain",
        );
      } else {
        console.warn(
          "[PRINT DAEMON] Not primary hub — Bluetooth drain idle. Claim hub in Admin → Imprimantes.",
        );
      }

      if (cancelled) return;

      // Always start the drain loop. It polls isLocalDevicePrimaryHub() and
      // idles until this phone is hub — or until nativeDrainActive.
      stopDaemon = startPrintQueueDaemon();
      wakePrintQueueDaemon();

      if (!isPrimaryHub || cancelled) return;

      // Auto "Vérifier Bluetooth" on tablet open — no Admin click required.
      cancelAutoProbe = scheduleHubAutoBluetoothProbe(2500);

      const handlePayload = (payload: PostgresPayload) => {
        if (payload.eventType === "DELETE") return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = payload.new as any;
        if (!row || row.status !== "pending") return;
        if (isNativePrintWorkerActive()) {
          void wakeNativePrintWorker();
        }
        wakePrintQueueDaemon();
      };

      manager = new RealtimeManager({
        channelName: `print-jobs-daemon-${deviceId.slice(0, 8)}`,
        listeners: [
          {
            schema: "public",
            table: "print_jobs",
            onPayload: handlePayload,
          },
        ],
        onResync: async () => {
          wakePrintQueueDaemon();
        },
      });
      _daemonManager = manager;
      void manager.init();
      wakePrintQueueDaemon();
    })();

    return () => {
      cancelled = true;
      console.log("[PRINT DAEMON] Unmount");
      cancelAutoProbe?.();
      stopDaemon?.();
      if (manager) {
        void manager.destroy();
        if (_daemonManager === manager) _daemonManager = null;
      }
    };
  }, [isPrimaryHub, loading, primaryDeviceId]);

  return null;
}
