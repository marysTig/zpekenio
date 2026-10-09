import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChefHat, Utensils, Armchair, BarChart3, Menu, X, Users, UserCircle, Printer as PrinterIcon, Plus } from "lucide-react";
import { MenuManager } from "@/components/admin/MenuManager";
import { ZReport } from "@/components/admin/ZReport";
import { AdminLogin } from "@/components/auth/AdminLogin";
import { useAuthStore } from "@/lib/authStore";
import { UserManager } from "@/components/admin/UserManager";
import { AdminProfile } from "@/components/admin/AdminProfile";
import { PrinterManager } from "@/components/admin/PrinterManager";
import { GlobalSupplementsManager } from "@/components/admin/GlobalSupplementsManager";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type Tab = "menu" | "rapport" | "utilisateurs" | "imprimantes" | "profil" | "supplements";

const navItems = [
  { id: "menu"         as const, icon: Utensils,    label: "Gestion du Menu" },
  { id: "rapport"      as const, icon: BarChart3,   label: "Rapport Z" },
  { id: "utilisateurs" as const, icon: Users,       label: "Utilisateurs" },
  { id: "imprimantes"  as const, icon: PrinterIcon, label: "Imprimantes" },
  { id: "supplements"  as const, icon: Plus,        label: "Suppléments" },
  { id: "profil"       as const, icon: UserCircle,  label: "Mon Profil" },
];

function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("menu");
  const [isOpen, setIsOpen] = useState(true);
  const isAuthenticated = useAuthStore((s) => s.isAdminAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  // Show login gate if not authenticated
  if (!isAuthenticated) {
    return <AdminLogin onSuccess={() => {}} />;
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background font-sans">

      {/* ── SIDEBAR ── */}
      <aside
        className={`flex-col bg-sidebar text-sidebar-foreground border-r border-border transition-all duration-300 ${isOpen ? "flex w-60" : "hidden"}`}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary">
            <ChefHat className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-extrabold uppercase tracking-tight">Admin CPanel</span>
        </div>

        {/* Nav */}
        <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                activeTab === id
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Close button at the bottom */}
        <div className="border-t border-sidebar-border p-3 flex flex-col gap-2">
          <button
            onClick={() => setIsOpen(false)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <X className="h-5 w-5 shrink-0" />
            <span>Fermer le panneau</span>
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive/80 transition-colors hover:bg-destructive/20 hover:text-destructive"
          >
            <X className="h-5 w-5 shrink-0 opacity-0" />
            <span className="-ml-8">Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-5">
          {/* Open button — only visible when sidebar is closed */}
          {!isOpen && (
            <button
              onClick={() => setIsOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Ouvrir le panneau"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-semibold">
            {activeTab === "menu"         && "Gestion du Menu"}
            {activeTab === "rapport"      && "Rapport Z"}
            {activeTab === "utilisateurs" && "Gestion des Utilisateurs"}
            {activeTab === "imprimantes"  && "Imprimantes"}
            {activeTab === "supplements"  && "Suppléments de Commande"}
            {activeTab === "profil"       && "Mon Profil"}
          </h1>
        </header>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "menu"         && (
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              <MenuManager />
            </div>
          )}
          {activeTab === "rapport"      && <ZReport />}
          {activeTab === "utilisateurs" && <UserManager />}
          {activeTab === "imprimantes"  && <PrinterManager />}
          {activeTab === "supplements"  && <GlobalSupplementsManager />}
          {activeTab === "profil"       && <AdminProfile />}
        </div>
      </main>
    </div>
  );
}
