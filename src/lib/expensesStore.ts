import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/lib/authStore";

export type Expense = {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
  created_by?: string;
};

const LOCAL_STORAGE_KEY = "pos_expenses_records";

function getLocalExpenses(): Expense[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalExpenses(expenses: Expense[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(expenses));
  } catch {
    // Ignore storage quota errors
  }
}

interface ExpensesState {
  expenses: Expense[];
  loading: boolean;
  fetchExpenses: () => Promise<void>;
  addExpense: (amount: number, reason: string, customDate?: string, author?: string) => Promise<{ ok: boolean; error?: string }>;
  deleteExpense: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export const useExpensesStore = create<ExpensesState>((set, get) => ({
  expenses: getLocalExpenses(),
  loading: false,

  fetchExpenses: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        // Table might not exist yet in Supabase, gracefully use local storage
        console.warn("[expensesStore] Supabase fetch error, fallback to local storage:", error.message);
        set({ expenses: getLocalExpenses() });
      } else if (data) {
        const mapped: Expense[] = data.map((row: any) => ({
          id: String(row.id),
          amount: Number(row.amount),
          reason: String(row.reason),
          created_at: String(row.created_at),
          created_by: row.created_by ? String(row.created_by) : undefined,
        }));
        set({ expenses: mapped });
        saveLocalExpenses(mapped);
      }
    } catch (err) {
      console.warn("[expensesStore] Network/fetch error:", err);
      set({ expenses: getLocalExpenses() });
    } finally {
      set({ loading: false });
    }
  },

  addExpense: async (amount: number, reason: string, customDate?: string, author?: string) => {
    const username = author || useSessionStore.getState().currentUser?.username || "Caisse";
    const newExpense: Expense = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `exp_${Date.now()}`,
      amount,
      reason: reason.trim(),
      created_at: customDate || new Date().toISOString(),
      created_by: username,
    };

    // Optimistic local update
    const previous = get().expenses;
    const updated = [newExpense, ...previous].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    set({ expenses: updated });
    saveLocalExpenses(updated);

    try {
      const { error } = await supabase.from("expenses").insert({
        id: newExpense.id,
        amount: newExpense.amount,
        reason: newExpense.reason,
        created_at: newExpense.created_at,
        created_by: newExpense.created_by,
      });

      if (error) {
        console.warn("[expensesStore] Supabase insert failed (persisted in local storage):", error.message);
      }
      return { ok: true };
    } catch (err: any) {
      console.warn("[expensesStore] Failed to save to Supabase (persisted locally):", err);
      return { ok: true };
    }
  },

  deleteExpense: async (id: string) => {
    const updated = get().expenses.filter((e) => e.id !== id);
    set({ expenses: updated });
    saveLocalExpenses(updated);

    try {
      await supabase.from("expenses").delete().eq("id", id);
      return { ok: true };
    } catch {
      return { ok: true };
    }
  },
}));

/**
 * Subscribe to realtime changes on the expenses table in Supabase.
 */
export function setupExpensesRealtime() {
  const channel = supabase
    .channel("expenses-realtime-channel")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "expenses" },
      () => {
        useExpensesStore.getState().fetchExpenses();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
