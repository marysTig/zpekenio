/**
 * Client-side activity log for caisse print attempts.
 */

export type PrintActivityEntry = {
  id: string;
  at: string;
  kind: "caisse" | "test";
  printerName: string;
  mac: string | null;
  status: "started" | "success" | "error";
  detail?: string;
};

const MAX = 40;
const listeners = new Set<() => void>();
let entries: PrintActivityEntry[] = [];

function emit() {
  for (const l of listeners) l();
}

export function logPrintActivity(
  entry: Omit<PrintActivityEntry, "id" | "at"> & { detail?: string },
): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const row: PrintActivityEntry = {
    id,
    at: new Date().toISOString(),
    ...entry,
  };
  entries = [row, ...entries].slice(0, MAX);
  console.log(
    `[PRINT ACTIVITY] ${row.kind} · ${row.status} · ${row.printerName}` +
      (row.detail ? ` · ${row.detail}` : ""),
  );
  emit();
  return id;
}

export function updatePrintActivity(
  id: string,
  patch: Partial<Pick<PrintActivityEntry, "status" | "detail">>,
): void {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  const row = entries.find((e) => e.id === id);
  if (row) {
    console.log(
      `[PRINT ACTIVITY] ${row.kind} · ${row.status} · ${row.printerName}` +
        (row.detail ? ` · ${row.detail}` : ""),
    );
  }
  emit();
}

export function getPrintActivity(): PrintActivityEntry[] {
  return entries;
}

export function subscribePrintActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
