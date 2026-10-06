import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";

/** Single-printer POS — Caisse only. */
export type PrinterType = "caisse";

export function normalizePrinterType(_raw: unknown): PrinterType {
  return "caisse";
}

export type Printer = {
  id: string;
  name: string;
  type: PrinterType;
  mac_address: string | null;
  enabled: boolean;
  /** Kept for DB compatibility — always empty in single-printer mode. */
  categories: string[];
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
    .filter((row: any) => row["type"] === "caisse")
    .map((row: any) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      type: "caisse" as const,
      mac_address: (row["mac_address"] as string | null) ?? null,
      enabled: (row["enabled"] as boolean) ?? true,
      categories: [] as string[],
      category_ids: [] as string[],
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
    if (existing.length > 0) {
      throw new Error(
        "Une seule imprimante caisse est autorisée. Modifiez ou supprimez l'existante.",
      );
    }
    const { error } = await supabase.from("printers").insert({
      name: printer.name,
      type: "caisse",
      mac_address: printer.mac_address || null,
      enabled: printer.enabled,
      categories: [],
      category_ids: [],
    });
    if (error) throw new Error(error.message);
    await reload();
  };

  const updatePrinter = async (id: string, printer: Partial<Printer>) => {
    const { error } = await supabase
      .from("printers")
      .update({
        ...(printer.name !== undefined && { name: printer.name }),
        type: "caisse",
        ...(printer.mac_address !== undefined && { mac_address: printer.mac_address }),
        ...(printer.enabled !== undefined && { enabled: printer.enabled }),
        categories: [],
        category_ids: [],
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
