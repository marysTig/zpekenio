import { Bell, Search, User, LogOut } from "lucide-react";
import { useSessionStore } from "@/lib/authStore";
import { useNavigate } from "@tanstack/react-router";

type TopBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
};

export function TopBar({ query, onQueryChange }: TopBarProps) {
  const currentUser = useSessionStore(s => s.currentUser);
  const logoutUser = useSessionStore(s => s.logoutUser);
  const navigate = useNavigate();

  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-card px-5 py-3 lg:flex lg:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold tracking-tight text-foreground">Caisse</h1>
        <p className="truncate text-xs text-muted-foreground">
          Prise de commande · Aujourd'hui — 17 Août 2026
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Rechercher un produit..."
            className="h-10 w-56 rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary lg:w-64"
          />
        </div>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            logoutUser();
            navigate({ to: "/" });
          }}
          className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
          title="Déconnexion"
        >
          <User className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-destructive" />
          <span className="hidden text-sm font-semibold sm:block">
            {currentUser?.username || "Caissier"}
          </span>
          <LogOut className="h-4 w-4 ml-1 opacity-60" />
        </button>
      </div>
    </header>
  );
}
