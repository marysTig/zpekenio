import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'caisse' | 'serveur';

export interface PosUser {
  id: string;
  username: string;
  password: string;
  role: UserRole;
  created_at?: string;
}

export interface CurrentSession {
  userId: string;
  username: string;
  role: UserRole;
}

// ── Admin row identity ────────────────────────────────────────────────────────
// The admin account is stored in pos_users with this fixed UUID.
// Supabase is the SINGLE SOURCE OF TRUTH — no credentials are ever cached locally.
export const ADMIN_ROW_ID = '00000000-0000-0000-0000-000000000001';

// Wipe any stale admin credential cache left by previous versions of this code.
// This ensures old passwords can no longer be used from localStorage on any device.
// Guard with typeof window to avoid crashing in SSR (Vercel/Node) environments.
(function clearStalAdminCache() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('admin-auth-storage');
  } catch {
    // Ignore
  }
})();

// ── Admin credential helpers (always hit Supabase) ───────────────────────────

/** Fetch the admin row from Supabase. */
async function fetchAdminRow(): Promise<{ username: string; password: string } | null> {
  const { data } = await supabase
    .from('pos_users')
    .select('username, password')
    .eq('id', ADMIN_ROW_ID)
    .maybeSingle();
  return data ?? null;
}

/** Save new admin credentials to Supabase — syncs to ALL devices. */
export async function updateAdminCredentials(updates: { username?: string; password?: string }): Promise<{ ok: boolean; error?: string }> {
  const payload: any = {};
  if (updates.username !== undefined) payload.username = updates.username.trim();
  if (updates.password !== undefined) payload.password = updates.password;

  const { error } = await supabase
    .from('pos_users')
    .update(payload)
    .eq('id', ADMIN_ROW_ID);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Verify the admin's current password against Supabase (used by AdminProfile before allowing a change). */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const row = await fetchAdminRow();
  return row !== null && row.password === password.trim();
}

// ── Admin auth store (session flag only — NO credentials stored) ──────────────

interface AdminAuthState {
  isAdminAuthenticated: boolean;
  /** Set the authenticated flag directly (call after Supabase confirms credentials). */
  setAdminAuthenticated: (value: boolean) => void;
  logout: () => void;
  // Legacy alias kept so admin.tsx doesn't need changes
  login: (u: string, p: string) => boolean;
}

export const useAuthStore = create<AdminAuthState>()((set) => ({
  isAdminAuthenticated: false,
  setAdminAuthenticated: (value) => set({ isAdminAuthenticated: value }),
  logout: () => set({ isAdminAuthenticated: false }),
  // Legacy: always returns false — real auth is done in AdminLogin via Supabase
  login: (_u, _p) => false,
}));

// ── POS session store (who is currently logged in) ───────────────────────────

interface SessionState {
  currentUser: CurrentSession | null;
  setCurrentUser: (user: CurrentSession | null) => void;
  loginUser: (username: string, password: string) => Promise<{ ok: boolean; error?: string; isAdmin?: boolean }>;
  logoutUser: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      loginUser: async (username: string, password: string) => {
        const u = username.trim().toLowerCase();
        const p = password.trim();

        // ── Step 1: Check admin row in Supabase (always — no local cache) ──
        const adminRow = await fetchAdminRow();
        if (adminRow && u === adminRow.username.toLowerCase() && p === adminRow.password) {
          set({
            currentUser: {
              userId: ADMIN_ROW_ID,
              username: adminRow.username,
              role: 'caisse',
            },
          });
          useAuthStore.getState().setAdminAuthenticated(true);
          return { ok: true, isAdmin: true };
        }

        // ── Step 2: Regular employee — query pos_users (skip admin row) ────
        const { data, error } = await supabase
          .from('pos_users')
          .select('id, username, password, role')
          .ilike('username', username.trim())
          .neq('id', ADMIN_ROW_ID)
          .limit(1)
          .maybeSingle();

        if (error) {
          return { ok: false, error: `Erreur DB: ${error.message}` };
        }

        if (!data) {
          return { ok: false, error: 'Utilisateur introuvable.' };
        }

        if (data.password !== p) {
          return { ok: false, error: 'Mot de passe incorrect.' };
        }

        set({
          currentUser: {
            userId: data.id,
            username: data.username,
            role: data.role as UserRole,
          },
        });
        return { ok: true };
      },

      logoutUser: () => {
        // Clear localStorage immediately so persist middleware cannot re-hydrate
        // the old session if the page is reloaded before the next setItem call.
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('pos-session-storage');
          } catch {
            // Ignore
          }
        }
        set({ currentUser: null });
      },
    }),
    {
      name: 'pos-session-storage',
      // localStorage so Capacitor/Android keeps the employee session after
      // process kill. sessionStorage was wiping login on every app close.
      // Explicit Déconnexion still clears via logoutUser → removeItem.
      storage: {
        getItem: (name) => {
          if (typeof window === 'undefined') return null;
          try {
            const val = localStorage.getItem(name);
            return val ? JSON.parse(val) : null;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          if (typeof window === 'undefined') return;
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch {
            // Ignore quota / private mode
          }
        },
        removeItem: (name) => {
          if (typeof window === 'undefined') return;
          try {
            localStorage.removeItem(name);
          } catch {
            // Ignore
          }
        },
      },
    }
  )
);

// ── User CRUD (Supabase) ──────────────────────────────────────────────────────

interface UsersState {
  users: PosUser[];
  loading: boolean;
  fetchUsers: () => Promise<void>;
  addUser: (username: string, password: string, role: UserRole) => Promise<{ ok: boolean; error?: string }>;
  deleteUser: (id: string) => Promise<void>;
}

export const useUsersStore = create<UsersState>((set) => ({
  users: [],
  loading: false,
  fetchUsers: async () => {
    set({ loading: true });
    const { data, error } = await supabase
      .from('pos_users')
      .select('id, username, password, role, created_at')
      .neq('id', ADMIN_ROW_ID)           // never show the admin row in the employee list
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Erreur chargement utilisateurs:', error.message);
      set({ loading: false });
      return;
    }
    set({ users: (data ?? []) as PosUser[], loading: false });
  },
  addUser: async (username, password, role) => {
    const trimmed = username.trim();
    if (!trimmed || !password) return { ok: false, error: 'Champs requis.' };

    const { error } = await supabase
      .from('pos_users')
      .insert({ username: trimmed, password, role });

    if (error) {
      if (error.code === '23505') return { ok: false, error: "Ce nom d'utilisateur existe déjà." };
      return { ok: false, error: error.message };
    }

    const { data } = await supabase
      .from('pos_users')
      .select('id, username, password, role, created_at')
      .neq('id', ADMIN_ROW_ID)
      .order('created_at', { ascending: true });
    set({ users: (data ?? []) as PosUser[] });
    return { ok: true };
  },
  deleteUser: async (id) => {
    await supabase.from('pos_users').delete().eq('id', id);
    set((state) => ({ users: state.users.filter((u) => u.id !== id) }));
  },
}));
