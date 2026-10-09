import {
  ChefHat,
  LogOut,
  Armchair,
  Utensils,
  ShoppingBag,
} from "lucide-react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTableStore } from "@/lib/tableStore";
import { useSessionStore } from "@/lib/authStore";

const nav = [
  { label: "Sur place", icon: Armchair,    to: "/tables" },
  { label: "Emporter", icon: ShoppingBag, to: "/emporter" },
];

type SidebarProps = {
  activePage?: string;
};

/**
 * Panneau de navigation latéral :
 *  - Mobile (< md)  : masqué (bottom nav prend le relais)
 *  - Tablette (md)  : visible, icônes seules, largeur 72 px
 *  - Desktop (≥ lg) : visible, icônes + labels, largeur 220 px
 */
export function Sidebar(_props: SidebarProps) {
  const location = useRouterState({ select: s => s.location.pathname });
  const { tables, rooms } = useTableStore();
  const currentUser = useSessionStore(s => s.currentUser);
  const logoutUser = useSessionStore(s => s.logoutUser);
  const role = currentUser?.role ?? "caisse";
  const navigate = useNavigate();
  
  const emporterRoom = rooms.find(r => r.name.toLowerCase() === "emporter");
  const activeEmporterCount = emporterRoom ? tables.filter(t => t.roomId === emporterRoom.id && t.status !== "libre").length : 0;

  const filteredNav = nav;

  return (
    <aside className="hidden md:flex md:w-[72px] lg:w-[220px] shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200">

      {/* Logo */}
      <div className="flex h-16 items-center justify-center gap-3 px-3 lg:justify-start lg:px-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary">
          <ChefHat className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="hidden truncate text-sm font-extrabold tracking-tight lg:block">
          Z-PEKENIO
        </span>
      </div>

      {/* Nav links */}
      <nav className="mt-2 flex flex-1 flex-col px-2 lg:px-3">
        <div className="flex flex-1 flex-col justify-center gap-1">
          {filteredNav.map((item) => {
            const active = location === item.to;
            return (
              <Link
                key={item.label}
                to={item.to}
                title={item.label}
                className={
                  active
                    ? "relative flex items-center justify-center gap-3 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground lg:justify-start"
                    : "relative flex items-center justify-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:justify-start"
                }
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="hidden truncate lg:block">{item.label}</span>
                {item.label === "Emporter" && activeEmporterCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 lg:h-5 lg:w-5 items-center justify-center rounded-full bg-orange-500 text-[9px] lg:text-[10px] font-bold text-white shadow-sm lg:right-3 lg:top-1/2 lg:-translate-y-1/2 ring-2 ring-sidebar">
                    {activeEmporterCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-center gap-3 lg:justify-start">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-bold uppercase">
            {role.substring(0, 2)}
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="truncate text-sm font-semibold capitalize">{role}</p>
            <p className="flex items-center gap-1.5 text-xs text-sidebar-foreground/60">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              En ligne
            </p>
          </div>
        </div>
        <button
          type="button"
          title="Déconnexion"
          onClick={() => {
            logoutUser();
            navigate({ to: "/" });
          }}
          className="mt-3 flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:justify-start"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden lg:block">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * Export vide conservé pour compatibilité (plus utilisé mais évite
 * les erreurs d'import dans TopBar / tables / emporter).
 */
export function TabletMenuButton() {
  return null;
}
