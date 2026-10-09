import { Armchair, Utensils, ShoppingBag, LogOut, ChefHat } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTableStore } from "@/lib/tableStore";
import { useSessionStore } from "@/lib/authStore";

const nav = [
  { label: "Sur place", icon: Armchair,    to: "/tables" },
  { label: "Emporter", icon: ShoppingBag, to: "/emporter" },
];

type MobileBottomNavProps = {
  activePage?: string;
};

export function MobileBottomNav(_props: MobileBottomNavProps) {
  const location = useRouterState({ select: s => s.location.pathname });
  const { tables, rooms } = useTableStore();
  const currentUser = useSessionStore(s => s.currentUser);
  const logoutUser = useSessionStore(s => s.logoutUser);
  const role = currentUser?.role ?? "caisse";
  
  const emporterRoom = rooms.find(r => r.name.toLowerCase() === "emporter");
  const activeEmporterCount = emporterRoom ? tables.filter(t => t.roomId === emporterRoom.id && t.status !== "libre").length : 0;

  const filteredNav = nav;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-border bg-sidebar px-2 pb-safe pt-2 md:hidden">
      {filteredNav.map((item) => {
        const active = location === item.to;
        return (
          <Link
            key={item.label}
            to={item.to}
            className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
              active ? "text-primary" : "text-sidebar-foreground/50"
            }`}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
            {item.label === "Emporter" && activeEmporterCount > 0 && (
              <span className="absolute -top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-sidebar">
                {activeEmporterCount}
              </span>
            )}
          </Link>
        );
      })}
      
      <button
        onClick={() => {
          logoutUser();
          window.location.replace("/tables");
        }}
        title="Déconnexion"
        className="relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors text-sidebar-foreground/50 hover:text-destructive active:scale-95"
      >
        <LogOut className="h-5 w-5" />
        <span className="text-[10px] font-medium">Quitter</span>
      </button>
    </nav>
  );
}
