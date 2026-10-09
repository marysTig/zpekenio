/**
 * Durable print queue — Caisse receipt only.
 * UI enqueues; PrintQueueDaemon / native hub owns Bluetooth.
 */

import { supabase } from "@/lib/supabase";
import type { CartItem } from "@/lib/cart";
import type { GlobalSupplement } from "@/lib/globalSupplementsStore";
import { getPrintersFromStore, type Printer } from "@/lib/printerStore";
import { getLocalPrintDeviceId } from "@/lib/printDevice";
import { buildReceiptEscPos, uint8ToBase64 } from "@/lib/escposTickets";

export const PRIORITY_RECEIPT = 100;
export const MAX_PRINT_ATTEMPTS = 3;
/** Single-printer profile — keep in sync with EscPosBluetoothPrinter / PrintJobRepository. */
export const RETRY_BACKOFF_MS = 2500;
export const RECEIPT_RETRY_BACKOFF_MS = 450;
/** @deprecated Single printer — MAC switch gap unused; kept for coordinator import. */
export const INTER_PRINTER_GAP_MS = 350;
export const RECEIPT_MAC_COOLDOWN_MS = 350;

export type PrintJobType = "kitchen" | "receipt";
export type PrintJobStatus =
  | "pending"
  | "printing"
  | "done"
  | "needs_manual"
  | "cancelled";

export type PrintJobPayload = {
  escposBase64: string;
  tableId: string;
  orderLabel: string | number;
  orderNote?: string;
  globalSupplements?: GlobalSupplement[];
};

export type PrintJob = {
  id: string;
  table_id: string | null;
  job_type: PrintJobType;
  priority: number;
  printer_id: string | null;
  printer_name: string | null;
  mac_address: string | null;
  idempotency_key: string;
  status: PrintJobStatus;
  attempt_count: number;
  next_attempt_at: string;
  claimed_by_device_id: string | null;
  payload: PrintJobPayload;
  error: string | null;
  created_at: string;
  updated_at: string;
  printed_at: string | null;
};

/** @deprecated Alias for Admin job list compatibility */
export type KitchenPrintJob = PrintJob;

export type EnqueueReceiptResult =
  | { status: "enqueued"; jobId: string }
  | { status: "noop"; reason: "no_printer" | "duplicate" }
  | { status: "error"; message: string };

const STALE_PRINTING_MS = 2 * 60 * 1000;

export type EnqueueReceiptParams = {
  tableId: string;
  orderLabel: string | number;
  items: CartItem[];
  total: number;
  globalSupplements?: GlobalSupplement[];
  checkoutTs?: number;
  printers?: Printer[];
  phone?: string;
};

/**
 * Enqueue caisse receipt — fire-and-forget, no Bluetooth.
 */
export async function enqueueReceipt(
  params: EnqueueReceiptParams,
): Promise<EnqueueReceiptResult> {
  const printers = params.printers ?? getPrintersFromStore();
  const caisse = printers.find(
    (p) => p.enabled && p.type === "caisse" && (p.mac_address || "").trim() !== "",
  );
  if (!caisse) {
    return { status: "noop", reason: "no_printer" };
  }

  const mac = caisse.mac_address!.trim();

  // table_id column is uuid — never insert fake strings like "receipt-2"
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const tableIdForDb =
    params.tableId && uuidRe.test(params.tableId) ? params.tableId : null;
  const idempotencyScope = params.tableId || String(params.orderLabel);

  const checkoutTs = params.checkoutTs ?? Date.now();
  const idempotencyKey = `receipt:${idempotencyScope}:${checkoutTs}`;
  const escpos = buildReceiptEscPos({
    items: params.items,
    total: params.total,
    tableNumber: params.orderLabel,
    ...(params.globalSupplements?.length
      ? { globalSupplements: params.globalSupplements }
      : {}),
    phone: params.phone,
  });
  const now = new Date().toISOString();
  const payload: PrintJobPayload = {
    escposBase64: uint8ToBase64(escpos),
    tableId: tableIdForDb ?? idempotencyScope,
    orderLabel: params.orderLabel,
  };
  if (params.globalSupplements?.length) {
    payload.globalSupplements = params.globalSupplements;
  }

  console.log("[print_jobs] receipt insert…");
  const { data, error } = await supabase
    .from("print_jobs")
    .insert({
      table_id: tableIdForDb,
      job_type: "receipt",
      priority: PRIORITY_RECEIPT,
      printer_id: caisse.id,
      printer_name: caisse.name,
      mac_address: mac,
      idempotency_key: idempotencyKey,
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      payload,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { status: "noop", reason: "duplicate" };
    }
    console.error("[print_jobs] receipt enqueue error:", error.message);
    return { status: "error", message: error.message };
  }
  console.log("[print_jobs] receipt enqueued", data?.id);
  return { status: "enqueued", jobId: (data?.id as string) ?? "" };
}

/** Cancel leftover kitchen jobs so they never reach the Bluetooth drain. */
export async function cancelLegacyKitchenJobs(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      status: "cancelled",
      error: "Cuisine désactivée — ticket ignoré",
      claimed_by_device_id: null,
      updated_at: now,
    })
    .eq("job_type", "kitchen")
    .in("status", ["pending", "printing", "needs_manual"])
    .select("id");
  if (error) {
    console.error("[print_jobs] cancel kitchen error:", error.message);
    return 0;
  }
  const n = data?.length ?? 0;
  if (n > 0) console.log(`[print_jobs] cancelled ${n} legacy kitchen job(s)`);
  return n;
}

export async function claimNextPrintJob(
  deviceId: string = getLocalPrintDeviceId(),
): Promise<PrintJob | null> {
  await cancelLegacyKitchenJobs();

  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "pending")
    .eq("job_type", "receipt")
    .lte("next_attempt_at", nowIso)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error("[print_jobs] claim fetch error:", error.message);
    return null;
  }
  if (!candidates?.length) return null;

  for (const row of candidates) {
    const { data, error: updErr } = await supabase
      .from("print_jobs")
      .update({
        status: "printing",
        claimed_by_device_id: deviceId,
        updated_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", (row as { id: string }).id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (!updErr && data) return mapJobRow(data);
  }
  return null;
}

export async function hasPendingReceiptJob(): Promise<boolean> {
  const { data } = await supabase
    .from("print_jobs")
    .select("id")
    .eq("job_type", "receipt")
    .in("status", ["pending", "printing"])
    .limit(1);
  return !!(data && data.length > 0);
}

/** True when any production job is pending or mid-print (blocks Admin probes). */
export async function hasActivePrintJobs(): Promise<boolean> {
  const { data } = await supabase
    .from("print_jobs")
    .select("id")
    .eq("job_type", "receipt")
    .in("status", ["pending", "printing"])
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * Immediately reclaim all `printing` jobs claimed by this device (daemon restart).
 */
export async function reclaimPrintingJobsForThisDevice(
  deviceId: string = getLocalPrintDeviceId(),
): Promise<PrintJob[]> {
  const { data: rows, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "printing")
    .eq("claimed_by_device_id", deviceId)
    .eq("job_type", "receipt");

  if (error || !rows?.length) return [];
  const claimed: PrintJob[] = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const { data, error: updErr } = await supabase
      .from("print_jobs")
      .update({
        status: "pending",
        claimed_by_device_id: null,
        next_attempt_at: now,
        updated_at: now,
        error: "Reprise après redémarrage hub",
      })
      .eq("id", (row as { id: string }).id)
      .eq("status", "printing")
      .eq("claimed_by_device_id", deviceId)
      .select("*")
      .maybeSingle();
    if (!updErr && data) claimed.push(mapJobRow(data));
  }
  if (claimed.length > 0) {
    console.log(
      `[print_jobs] reclaimed ${claimed.length} printing job(s) for device`,
    );
  }
  return claimed;
}

export async function reclaimStalePrintingJobs(
  deviceId: string = getLocalPrintDeviceId(),
): Promise<PrintJob[]> {
  const cutoff = new Date(Date.now() - STALE_PRINTING_MS).toISOString();
  const { data: stale, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "printing")
    .eq("job_type", "receipt")
    .lt("updated_at", cutoff);

  if (error) return [];
  const claimed: PrintJob[] = [];
  for (const row of stale ?? []) {
    const { data, error: updErr } = await supabase
      .from("print_jobs")
      .update({
        status: "pending",
        claimed_by_device_id: null,
        next_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: "Reprise après interruption",
      })
      .eq("id", (row as { id: string }).id)
      .eq("status", "printing")
      .lt("updated_at", cutoff)
      .select("*")
      .maybeSingle();
    if (!updErr && data) claimed.push(mapJobRow(data));
  }
  void deviceId;
  return claimed;
}

export async function markPrintJobDone(jobId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("print_jobs")
    .update({
      status: "done",
      printed_at: now,
      updated_at: now,
      error: null,
    })
    .eq("id", jobId);
}

export async function schedulePrintJobRetry(
  jobId: string,
  attemptCount: number,
  message: string,
  backoffMs: number = RETRY_BACKOFF_MS,
): Promise<"pending" | "needs_manual"> {
  const now = new Date();
  if (attemptCount >= MAX_PRINT_ATTEMPTS) {
    await supabase
      .from("print_jobs")
      .update({
        status: "needs_manual",
        attempt_count: attemptCount,
        error: message,
        claimed_by_device_id: null,
        updated_at: now.toISOString(),
      })
      .eq("id", jobId);
    return "needs_manual";
  }
  await supabase
    .from("print_jobs")
    .update({
      status: "pending",
      attempt_count: attemptCount,
      next_attempt_at: new Date(now.getTime() + backoffMs).toISOString(),
      error: message,
      claimed_by_device_id: null,
      updated_at: now.toISOString(),
    })
    .eq("id", jobId);
  return "pending";
}

export async function requeueInterruptedJob(jobId: string): Promise<void> {
  await supabase
    .from("print_jobs")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      claimed_by_device_id: null,
      error: "Interrompu — reprise",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "printing");
}

export async function retryAllNeedsManual(): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      claimed_by_device_id: null,
      error: null,
      updated_at: now,
    })
    .eq("status", "needs_manual")
    .eq("job_type", "receipt")
    .select("id");
  if (error) {
    console.error("[print_jobs] retry all error:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function fetchNeedsManualJobs(): Promise<PrintJob[]> {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "needs_manual")
    .eq("job_type", "receipt")
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []).map(mapJobRow);
}

export async function fetchRecentPrintJobs(limit = 30): Promise<PrintJob[]> {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("job_type", "receipt")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map(mapJobRow);
}

export async function markKitchenJobDone(jobId: string): Promise<void> {
  return markPrintJobDone(jobId);
}

export async function requeueFailedKitchenJob(jobId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("print_jobs")
    .update({
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      claimed_by_device_id: null,
      error: null,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("job_type", "receipt")
    .in("status", ["needs_manual", "cancelled"]);
}

export async function fetchRecentKitchenJobs(
  limit = 20,
): Promise<PrintJob[]> {
  return fetchRecentPrintJobs(limit);
}

export const MAX_KITCHEN_PRINT_ATTEMPTS = MAX_PRINT_ATTEMPTS;

export function kitchenJobAttemptCount(job: PrintJob): number {
  return job.attempt_count ?? 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJobRow(row: any): PrintJob {
  return {
    id: row.id as string,
    table_id: (row.table_id as string | null) ?? null,
    job_type: (row.job_type as PrintJobType) ?? "receipt",
    priority: (row.priority as number) ?? PRIORITY_RECEIPT,
    printer_id: (row.printer_id as string | null) ?? null,
    printer_name: (row.printer_name as string | null) ?? null,
    mac_address: (row.mac_address as string | null) ?? null,
    idempotency_key: row.idempotency_key as string,
    status: row.status as PrintJobStatus,
    attempt_count: (row.attempt_count as number) ?? 0,
    next_attempt_at: (row.next_attempt_at as string) ?? row.created_at,
    claimed_by_device_id: (row.claimed_by_device_id as string | null) ?? null,
    payload: row.payload as PrintJobPayload,
    error: (row.error as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    printed_at: (row.printed_at as string | null) ?? null,
  };
}
