import { useEffect } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { CartItem } from "@/lib/cart";
import { RealtimeManager, type PostgresPayload } from "@/lib/realtimeManager";
import type { GlobalSupplement } from "@/lib/globalSupplementsStore";

// ── Types ─────────────────────────────────────────────────────────────────────

type TableOrdersState = {
  orders: Record<string, CartItem[]>;
  orderNotes: Record<string, string>;
  orderSupplements: Record<string, GlobalSupplement[]>;
  // Internal actions (used by realtime listener)
  _patchOrder: (tableId: string, items: CartItem[]) => void;
  _patchNote: (tableId: string, note: string) => void;
  _patchSupplements: (tableId: string, supplements: GlobalSupplement[]) => void;
  _removeOrder: (tableId: string) => void;
  _setAll: (
    orders: Record<string, CartItem[]>, 
    notes: Record<string, string>,
    supplements: Record<string, GlobalSupplement[]>
  ) => void;
  // Public API — identical to the previous localStorage store
  setOrder: (tableId: string, items: CartItem[]) => void;
  setOrderNote: (tableId: string, note: string) => void;
  setOrderSupplements: (tableId: string, supplements: GlobalSupplement[]) => void;
  flushOrder: (tableId: string) => Promise<void>;
  clearOrder: (tableId: string) => void;
  mergeOrders: (primaryId: string, sourceIds: string[]) => void;
};

// ── Debounced upsert — avoids flooding Supabase on every keystroke ─────────

// Track tables that were recently written locally — ignore Realtime echo for 2s
const localWriteTimestamps: Record<string, number> = {};
const upsertTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function scheduleUpsert(tableId: string, items: CartItem[], note: string, globalSupplements: GlobalSupplement[]) {
  clearTimeout(upsertTimers[tableId]);
  // Mark this table as locally-written so we can ignore the Realtime echo
  localWriteTimestamps[tableId] = Date.now();
  upsertTimers[tableId] = setTimeout(async () => {
    const { error } = await supabase.from("table_orders").upsert(
      { 
        table_id: tableId, 
        items, 
        note, 
        global_supplements: globalSupplements,
        updated_at: new Date().toISOString() 
      },
      { onConflict: "table_id" },
    );
    if (error) console.error("[table_orders] upsert error:", error.message);
  }, 300);
}

async function deleteFromDB(tableId: string) {
  clearTimeout(upsertTimers[tableId]);
  const { error } = await supabase
    .from("table_orders")
    .delete()
    .eq("table_id", tableId);
  if (error) console.error("[table_orders] delete error:", error.message);
}

// ── Zustand store ─────────────────────────────────────────────────────────────

export const useTableOrdersStore = create<TableOrdersState>((set, get) => ({
  orders: {},
  orderNotes: {},
  orderSupplements: {},

  // ── Internal ──────────────────────────────────────────────────────────────

  _setAll: (orders, notes, supplements) => set({ orders, orderNotes: notes, orderSupplements: supplements }),

  _patchOrder: (tableId, items) =>
    set((state) => ({ orders: { ...state.orders, [tableId]: items } })),

  _patchNote: (tableId, note) =>
    set((state) => ({ orderNotes: { ...state.orderNotes, [tableId]: note } })),

  _patchSupplements: (tableId, supplements) =>
    set((state) => ({ orderSupplements: { ...state.orderSupplements, [tableId]: supplements } })),

  _removeOrder: (tableId) =>
    set((state) => {
      const orders = { ...state.orders };
      const orderNotes = { ...state.orderNotes };
      const orderSupplements = { ...state.orderSupplements };
      delete orders[tableId];
      delete orderNotes[tableId];
      delete orderSupplements[tableId];
      return { orders, orderNotes, orderSupplements };
    }),

  // ── Public API ────────────────────────────────────────────────────────────

  setOrder: (tableId, items) => {
    const note = get().orderNotes[tableId] ?? "";
    const supplements = get().orderSupplements[tableId] ?? [];
    set((s) => ({ orders: { ...s.orders, [tableId]: items } }));
    scheduleUpsert(tableId, items, note, supplements);
  },

  setOrderNote: (tableId, note) => {
    const items = get().orders[tableId] ?? [];
    const supplements = get().orderSupplements[tableId] ?? [];
    set((s) => ({ orderNotes: { ...s.orderNotes, [tableId]: note } }));
    scheduleUpsert(tableId, items, note, supplements);
  },

  setOrderSupplements: (tableId, supplements) => {
    const items = get().orders[tableId] ?? [];
    const note = get().orderNotes[tableId] ?? "";
    set((s) => ({ orderSupplements: { ...s.orderSupplements, [tableId]: supplements } }));
    scheduleUpsert(tableId, items, note, supplements);
  },

  // Upsert immédiat (sans debounce) — à appeler au moment de valider une commande
  // pour s'assurer que les données sont dans Supabase avant que la Caisse encaisse.
  flushOrder: async (tableId) => {
    clearTimeout(upsertTimers[tableId]);
    const items = get().orders[tableId] ?? [];
    const note = get().orderNotes[tableId] ?? "";
    const supplements = get().orderSupplements[tableId] ?? [];
    const { error } = await supabase.from("table_orders").upsert(
      { 
        table_id: tableId, 
        items, 
        note,
        global_supplements: supplements,
        updated_at: new Date().toISOString() 
      },
      { onConflict: "table_id" },
    );
    if (error) console.error("[table_orders] flushOrder error:", error.message);
  },

  clearOrder: (tableId) => {
    set((state) => {
      const orders = { ...state.orders };
      const orderNotes = { ...state.orderNotes };
      const orderSupplements = { ...state.orderSupplements };
      delete orders[tableId];
      delete orderNotes[tableId];
      delete orderSupplements[tableId];
      return { orders, orderNotes, orderSupplements };
    });
    deleteFromDB(tableId);
  },

  mergeOrders: (primaryId, sourceIds) => {
    set((state) => {
      const newOrders = { ...state.orders };
      const newNotes = { ...state.orderNotes };
      const newSupplements = { ...state.orderSupplements };
      
      let combinedItems = [...(newOrders[primaryId] || [])];
      const noteParts: string[] = [];
      let combinedSupplements = [...(newSupplements[primaryId] || [])];

      if (newNotes[primaryId]) noteParts.push(newNotes[primaryId]);

      for (const id of sourceIds) {
        if (newOrders[id]) {
          combinedItems = [...combinedItems, ...newOrders[id]];
          delete newOrders[id];
        }
        if (newNotes[id]) {
          noteParts.push(newNotes[id]);
          delete newNotes[id];
        }
        if (newSupplements[id]) {
          combinedSupplements = [...combinedSupplements, ...newSupplements[id]];
          delete newSupplements[id];
        }
      }

      // Deduplicate supplements based on id
      const seen = new Set<string>();
      combinedSupplements = combinedSupplements.filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      newOrders[primaryId] = combinedItems;
      const mergedNote = noteParts.join(" | ");
      if (mergedNote) newNotes[primaryId] = mergedNote;
      if (combinedSupplements.length > 0) newSupplements[primaryId] = combinedSupplements;

      // Sync to Supabase
      scheduleUpsert(primaryId, newOrders[primaryId], newNotes[primaryId] ?? "", newSupplements[primaryId] ?? []);
      for (const id of sourceIds) deleteFromDB(id);

      return { orders: newOrders, orderNotes: newNotes, orderSupplements: newSupplements };
    });
  },
}));

// ── Resync depuis Supabase ─────────────────────────────────────────────────────

async function resyncTableOrders(): Promise<void> {
  const { data, error } = await supabase
    .from("table_orders")
    .select("table_id, items, note, global_supplements");

  if (error) {
    console.error("[table_orders] resync error:", error.message);
    throw error;
  }

  const orders: Record<string, CartItem[]> = {};
  const notes: Record<string, string> = {};
  const supplements: Record<string, GlobalSupplement[]> = {};
  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orders[(row as any).table_id] = (row as any).items as CartItem[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notes[(row as any).table_id] = (row as any).note ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supplements[(row as any).table_id] = ((row as any).global_supplements as GlobalSupplement[]) ?? [];
  }
  useTableOrdersStore.getState()._setAll(orders, notes, supplements);
}

// ── Payload handler (logique métier Realtime inchangée) ───────────────────────

function handleTableOrderPayload(payload: PostgresPayload): void {
  const store = useTableOrdersStore.getState();
  if (payload.eventType === "DELETE") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store._removeOrder((payload.old as any).table_id);
  } else {
    // INSERT or UPDATE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = payload.new as any;
    const tableId = row.table_id as string;

    // Ignore Realtime echo for 2 seconds after a local write
    // This prevents the "disappear then reappear" flicker on item add
    const lastWrite = localWriteTimestamps[tableId];
    if (lastWrite && Date.now() - lastWrite < 2000) {
      return;
    }

    store._patchOrder(tableId, row.items as CartItem[]);
    store._patchNote(tableId, row.note ?? "");
    store._patchSupplements(tableId, row.global_supplements ?? []);
  }
}

// ── Singleton RealtimeManager pour table_orders ────────────────────────────────

let _tableOrdersManager: RealtimeManager | null = null;

function getTableOrdersManager(): RealtimeManager {
  if (!_tableOrdersManager) {
    _tableOrdersManager = new RealtimeManager({
      channelName: "table-orders-realtime",
      listeners: [
        {
          schema: "public",
          table: "table_orders",
          onPayload: handleTableOrderPayload,
        },
      ],
      onResync: resyncTableOrders,
    });
  }
  return _tableOrdersManager;
}

/** Exposé pour que __root.tsx puisse déclencher handleForeground() */
export function getTableOrdersRealtimeManager(): RealtimeManager {
  return getTableOrdersManager();
}

/**
 * Appeler ce hook UNE SEULE FOIS dans le composant racine (RootComponent).
 * Il charge les commandes depuis Supabase et active le Realtime.
 */
export function useTableOrdersSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const manager = getTableOrdersManager();
    void manager.init();
    // Pas de destroy() ici : le manager est un singleton global qui doit
    // rester actif pendant toute la durée de vie de l'app.
  }, [enabled]);
}