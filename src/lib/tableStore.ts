import { useEffect } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { type TableStatus } from "@/data/tables";
import { RealtimeManager, type PostgresPayload } from "@/lib/realtimeManager";

export type RoomItem = {
  id: string;
  name: string;
};

export type TableItem = {
  id: string;
  number: number;
  seats?: number;
  status: TableStatus;
  roomId?: string;
  orderTotal?: number;
  occupiedSince?: string;
  parentTableId?: string | null;
};

// ── Global State (Zustand) ────────────────────────────────────────
type TableGlobalState = {
  rooms: RoomItem[];
  tables: TableItem[];
  loading: boolean;
  setRooms: (rooms: RoomItem[]) => void;
  setTables: (tables: TableItem[] | ((prev: TableItem[]) => TableItem[])) => void;
  setLoading: (loading: boolean) => void;
};

const useTableGlobalState = create<TableGlobalState>((set) => ({
  rooms: [],
  tables: [],
  loading: true,
  setRooms: (rooms) => set({ rooms }),
  setTables: (tables) => set((state) => ({
    tables: typeof tables === 'function' ? tables(state.tables) : tables
  })),
  setLoading: (loading) => set({ loading }),
}));

// ── Supabase helpers ──────────────────────────────────────────────

async function fetchRoomsFromDB(): Promise<RoomItem[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur chargement salles:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row["id"] as string,
    name: row["name"] as string,
  }));
}

async function fetchTablesFromDB(): Promise<TableItem[]> {
  const { data, error } = await supabase
    .from("tables")
    .select("id, number, seats, status, room_id, order_total, occupied_since, parent_table_id, created_at")
    .order("number", { ascending: true });

  if (error) {
    console.error("Erreur chargement tables:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const item: TableItem = {
      id: row["id"] as string,
      number: row["number"] as number,
      seats: row["seats"] as number,
      status: (row["status"] as TableStatus) ?? "libre",
      roomId: row["room_id"] as string,
    };
    if (row["order_total"] != null) {
      item.orderTotal = row["order_total"] as number;
    }
    if (row["occupied_since"] != null) {
      item.occupiedSince = row["occupied_since"] as string;
    }
    if (row["parent_table_id"] !== undefined) {
      item.parentTableId = row["parent_table_id"] as string | null;
    }
    return item;
  });
}

export async function reloadTableStore(isInitialLoad = false) {
  const store = useTableGlobalState.getState();
  if (isInitialLoad) store.setLoading(true);
  try {
    const [fetchedRooms, fetchedTables] = await Promise.all([
      fetchRoomsFromDB(),
      fetchTablesFromDB(),
    ]);
    store.setRooms(fetchedRooms);
    store.setTables(fetchedTables);
  } catch (error) {
    console.error("Error reloading table store:", error);
    throw error;
  } finally {
    store.setLoading(false);
  }
}

// ── Payload handler (logique métier Realtime inchangée) ───────────

function handleTableRoomPayload(payload: PostgresPayload): void {
  const store = useTableGlobalState.getState();

  if (payload.table === "rooms") {
    if (payload.eventType === "DELETE") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.setRooms(store.rooms.filter(r => r.id !== (payload.old as any).id));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newRoom = { id: (payload.new as any).id, name: (payload.new as any).name };
      const exists = store.rooms.some(r => r.id === newRoom.id);
      store.setRooms(
        exists
          ? store.rooms.map(r => r.id === newRoom.id ? newRoom : r)
          : [...store.rooms, newRoom]
      );
    }
    return;
  }

  if (payload.table === "tables") {
    if (payload.eventType === "DELETE") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.setTables((prev) => prev.filter(t => t.id !== (payload.old as any).id));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = payload.new as any;
      const item: TableItem = {
        id: row["id"],
        number: row["number"],
        seats: row["seats"],
        status: row["status"] ?? "libre",
        roomId: row["room_id"],
      };
      if (row["order_total"] != null) item.orderTotal = row["order_total"];
      if (row["occupied_since"] != null) item.occupiedSince = row["occupied_since"];
      if (row["parent_table_id"] !== undefined) item.parentTableId = row["parent_table_id"];

      store.setTables((prev) => {
        if (prev.some(t => t.id === item.id)) {
          return prev.map(t => t.id === item.id ? item : t);
        }
        return [...prev, item].sort((a, b) => a.number - b.number);
      });
    }
  }
}

// ── Singleton RealtimeManager pour tables+rooms ───────────────────

let _tableRoomManager: RealtimeManager | null = null;

function getTableRoomManager(): RealtimeManager {
  if (!_tableRoomManager) {
    _tableRoomManager = new RealtimeManager({
      channelName: "tables-rooms-realtime",
      listeners: [
        {
          schema: "public",
          table: "rooms",
          onPayload: handleTableRoomPayload,
        },
        {
          schema: "public",
          table: "tables",
          onPayload: handleTableRoomPayload,
        },
      ],
      onResync: () => reloadTableStore(false),
    });
  }
  return _tableRoomManager;
}

/** Exposé pour que __root.tsx puisse déclencher handleForeground() */
export function getTableRealtimeManager(): RealtimeManager {
  return getTableRoomManager();
}

// ── Hook Realtime (appelé une seule fois dans RootComponent) ──────

export function useTableSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const manager = getTableRoomManager();
    void manager.init();
    // Pas de destroy() ici : le manager est un singleton global qui doit
    // rester actif pendant toute la durée de vie de l'app.
  }, [enabled]);
}

// ── Hook principal ────────────────────────────────────────────────

export function useTableStore() {
  const { rooms, tables, loading, setTables } = useTableGlobalState();

  const reload = reloadTableStore;

  // ── CRUD Salles ─────────────────────────────────────────────────

  const addRoom = async (name: string) => {
    // Optimistic: generate UUID client-side so the caller gets an ID instantly
    const id = crypto.randomUUID();
    const { setRooms: _setRooms } = useTableGlobalState.getState();
    _setRooms([...useTableGlobalState.getState().rooms, { id, name }]);

    const { error } = await supabase.from("rooms").insert({ id, name });
    if (error) {
      // Rollback optimistic entry
      _setRooms(useTableGlobalState.getState().rooms.filter((r) => r.id !== id));
      throw new Error(error.message);
    }
    return id;
  };

  const deleteRoom = async (id: string) => {
    const { error } = await supabase.from("rooms").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  // ── CRUD Tables ─────────────────────────────────────────────────

  const addTable = async (table: Omit<TableItem, "id">) => {
    // Optimistic: generate UUID client-side so sidebar opens immediately
    const id = crypto.randomUUID();
    const optimisticTable: TableItem = { ...table, id };
    setTables((prev) => [...prev, optimisticTable].sort((a, b) => a.number - b.number));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: Record<string, any> = {
      id,
      number: table.number,
      status: table.status,
    };
    if (table.seats !== undefined) insertPayload["seats"] = table.seats;
    if (table.roomId) insertPayload["room_id"] = table.roomId;

    const { error } = await supabase.from("tables").insert(insertPayload);
    if (error) {
      // Rollback optimistic entry
      setTables((prev) => prev.filter((t) => t.id !== id));
      throw new Error(error.message);
    }
    return id;
  };

  const updateTable = async (id: string, table: Partial<TableItem>) => {
    // Optimistic update
    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...table } : t))
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};
    if (table.number !== undefined) payload["number"] = table.number;
    if (table.seats !== undefined) payload["seats"] = table.seats;
    if (table.status !== undefined) payload["status"] = table.status;
    if (table.roomId !== undefined) payload["room_id"] = table.roomId;
    if (table.orderTotal !== undefined) payload["order_total"] = table.orderTotal;
    if (table.occupiedSince !== undefined) payload["occupied_since"] = table.occupiedSince;
    // Force null if explicitly passed as null (though typed as string, we might pass null as any to clear it)
    if (table.occupiedSince === null) payload["occupied_since"] = null;
    if (table.parentTableId !== undefined) payload["parent_table_id"] = table.parentTableId;

    const { error } = await supabase.from("tables").update(payload).eq("id", id);
    if (error) {
      console.error("Erreur updateTable:", error.message);
      // Fallback
      await reload();
      throw new Error(error.message);
    }
    // We rely on the Supabase Realtime subscription to reload the data eventually,
    // or the optimistic state will persist until refresh.
  };

  const deleteTable = async (id: string) => {
    const { error } = await supabase.from("tables").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  const mergeTablesDB = async (primaryId: string, otherIds: string[], totalAmountToAdd: number) => {
    const primary = tables.find(t => t.id === primaryId);
    if (primary) {
      await updateTable(primaryId, {
        orderTotal: (primary.orderTotal || 0) + totalAmountToAdd
      });
    }

    for (const id of otherIds) {
      const payload: Partial<TableItem> = {
        orderTotal: 0,
        parentTableId: primaryId
      };
      await updateTable(id, payload);
    }
  };

  return {
    rooms,
    tables,
    loading,
    reload,
    addRoom,
    deleteRoom,
    addTable,
    updateTable,
    deleteTable,
    mergeTablesDB,
  };
}
