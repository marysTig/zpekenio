import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";

/** Two-printer POS — Caisse (receipts) + Four/Cuisine (kitchen). */
export type PrinterType = "caisse" | "four";

/**
 * Normalize raw DB type to the two canonical app types.
 * 'cuisine' is a migration alias for 'four' — treat them identically.
 */
export function normalizePrinterType(raw: unknown): PrinterType {
  if (raw === "four" || raw === "cuisine") return "four";
  return "caisse";
}

export type Printer = {
  id: string;
  name: string;
  type: PrinterType;
  mac_address: string | null;
  enabled: boolean;
  /** Category names for display (four only). */
  categories: string[];
  /** Category IDs to filter which items print on the four. */
  category_ids: string[];
};

type PrinterGlobalState = {
  printers: Printer[];
  loading: boolean;
  setPrinters: (printers: Printer[]) => void;
  setLoading: (loading: boolean) => void;
};

const usePrinterGlobalState = create<PrinterGlobalState>((set) => ({
  printers: [],
  loading: true,
  setPrinters: (printers) => set({ printers }),
  setLoading: (loading) => set({ loading }),
}));

async function fetchPrintersFromDB(): Promise<Printer[]> {
  const { data, error } = await supabase
    .from("printers")
    .select("id, name, type, mac_address, enabled, categories, category_ids, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur chargement imprimantes:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? [])
    // 'cuisine' is a SQL-migration alias for 'four' — keep both
    .filter((row: any) => row["type"] === "caisse" || row["type"] === "four" || row["type"] === "cuisine")
    .map((row: any) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      type: normalizePrinterType(row["type"]),
      mac_address: (row["mac_address"] as string | null) ?? null,
      enabled: (row["enabled"] as boolean) ?? true,
      categories: (row["categories"] as string[]) ?? [],
      category_ids: (row["category_ids"] as string[]) ?? [],
    }));
}

let _printerInitialized = false;

async function _initPrinterStore(
  setPrinters: (p: Printer[]) => void,
  setLoading: (l: boolean) => void,
) {
  if (_printerInitialized) return;
  _printerInitialized = true;

  setLoading(true);
  const printers = await fetchPrintersFromDB();
  setPrinters(printers);
  setLoading(false);

  const reload = async () => {
    setLoading(true);
    const p = await fetchPrintersFromDB();
    setPrinters(p);
    setLoading(false);
  };

  supabase
    .channel("printers-global")
    .on("postgres_changes", { event: "*", schema: "public", table: "printers" }, reload)
    .subscribe();
}

export function usePrinterStore() {
  const { printers, loading, setPrinters, setLoading } = usePrinterGlobalState();

  useEffect(() => {
    _initPrinterStore(setPrinters, setLoading);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    setLoading(true);
    const p = await fetchPrintersFromDB();
    setPrinters(p);
    setLoading(false);
  }, [setPrinters, setLoading]);

  const addPrinter = async (printer: Omit<Printer, "id">) => {
    const existing = usePrinterGlobalState.getState().printers;
    const sameType = existing.filter((p) => p.type === printer.type);
    if (sameType.length > 0) {
      throw new Error(
        printer.type === "caisse"
          ? "Une seule imprimante caisse est autorisée."
          : "Une seule imprimante four est autorisée.",
      );
    }
    const { error } = await supabase.from("printers").insert({
      name: printer.name,
      type: printer.type,
      mac_address: printer.mac_address || null,
      enabled: printer.enabled,
      categories: printer.categories ?? [],
      category_ids: printer.category_ids ?? [],
    });
    if (error) throw new Error(error.message);
    await reload();
  };

  const updatePrinter = async (id: string, printer: Partial<Printer>) => {
    const existing = usePrinterGlobalState.getState().printers.find((p) => p.id === id);
    const resolvedType = printer.type ?? existing?.type ?? "caisse";
    const { error } = await supabase
      .from("printers")
      .update({
        ...(printer.name !== undefined && { name: printer.name }),
        type: resolvedType,
        ...(printer.mac_address !== undefined && { mac_address: printer.mac_address }),
        ...(printer.enabled !== undefined && { enabled: printer.enabled }),
        categories: printer.categories ?? existing?.categories ?? [],
        category_ids: printer.category_ids ?? existing?.category_ids ?? [],
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  const deletePrinter = async (id: string) => {
    const { error } = await supabase.from("printers").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  return {
    printers,
    loading,
    reload,
    addPrinter,
    updatePrinter,
    deletePrinter,
  };
}

/** Snapshot of printers without React (for queue worker / enqueue). */
export async function fetchPrintersOnce(): Promise<Printer[]> {
  return fetchPrintersFromDB();
}

export function getPrintersFromStore(): Printer[] {
  return usePrinterGlobalState.getState().printers;
}
