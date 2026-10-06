import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RealtimeManager, type PostgresPayload } from "@/lib/realtimeManager";
import {
  fetchNeedsManualJobs,
  retryAllNeedsManual,
  type PrintJob,
} from "@/lib/kitchenPrintQueue";
import { wakePrintQueueDaemon } from "@/lib/printQueueDaemon";
import {
  isNativePrintWorkerActive,
  nativeTriggerManualRetry,
  wakeNativePrintWorker,
} from "@/lib/hubPrintWorkerPlugin";

/**
 * POS-level banner when print jobs exhausted retries (needs_manual).
 * Retry All resets attempts — no Admin navigation required.
 */
export function PrintFailureBanner() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    const list = await fetchNeedsManualJobs();
    setJobs(list);
  }, []);

  useEffect(() => {
    void refresh();

    const manager = new RealtimeManager({
      channelName: "print-jobs-failure-banner",
      listeners: [
        {
          schema: "public",
          table: "print_jobs",
          onPayload: (payload: PostgresPayload) => {
            if (payload.eventType === "DELETE") {
              void refresh();
              return;
            }
            void refresh();
          },
        },
      ],
      onResync: async () => {
        await refresh();
      },
    });
    void manager.init();
    return () => {
      void manager.destroy();
    };
  }, [refresh]);

  const onRetryAll = async () => {
    if (retrying || jobs.length === 0) return;
    setRetrying(true);
    try {
      const n = await retryAllNeedsManual();
      if (isNativePrintWorkerActive()) {
        try {
          await nativeTriggerManualRetry();
        } catch {
          /* JS already reset needs_manual rows */
        }
        void wakeNativePrintWorker();
      }
      toast.success(
        n > 0
          ? `${n} ticket(s) remis en file d'impression`
          : "Aucun ticket à relancer",
      );
      await refresh();
      wakePrintQueueDaemon();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Relance impossible", { description: msg });
    } finally {
      setRetrying(false);
    }
  };

  if (jobs.length === 0) return null;

  const stations = [
    ...new Set(
      jobs.map((j) => j.printer_name).filter((n): n is string => !!n),
    ),
  ];

  return (
    <div
      role="alert"
      className="fixed bottom-0 inset-x-0 z-[90] border-t border-amber-700/40 bg-amber-950 text-amber-50 px-4 py-3 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {jobs.length} reçu{jobs.length > 1 ? "s" : ""} non imprimé
            {jobs.length > 1 ? "s" : ""}
          </p>
          {stations.length > 0 && (
            <p className="text-xs text-amber-200/90 truncate">
              Imprimante : {stations.join(" · ")}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={retrying}
          onClick={() => void onRetryAll()}
          className="shrink-0 rounded-md bg-amber-400 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {retrying ? "Relance…" : "Retry All"}
        </button>
      </div>
    </div>
  );
}
