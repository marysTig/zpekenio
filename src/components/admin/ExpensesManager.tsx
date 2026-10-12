import { useState, useEffect, useMemo } from "react";
import {
  Receipt,
  Plus,
  Trash2,
  Calendar,
  Search,
  Printer,
  TrendingDown,
  Clock,
  User,
  X,
  Check,
  Loader2,
  CalendarDays,
  DollarSign,
  ArrowDownCircle,
} from "lucide-react";
import {
  format,
  isToday,
  isYesterday,
  subDays,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
} from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { useExpensesStore, setupExpensesRealtime, type Expense } from "@/lib/expensesStore";

type PeriodFilter = "today" | "yesterday" | "week" | "month" | "custom" | "all";

const QUICK_REASONS = [
  "Pain",
  "Légumes",
  "Viande / Poulet",
  "Boissons",
  "Courses diverses",
  "Gaz / Énergie",
  "Entretien & Nettoyage",
  "Emballages",
  "Glace",
  "Autre",
];

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export function ExpensesManager() {
  const { expenses, loading, fetchExpenses, addExpense, deleteExpense, deleteExpensesBulk } = useExpensesStore();

  const [period, setPeriod] = useState<PeriodFilter>("today");
  const [customDate, setCustomDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  // Add Form state
  const [newAmount, setNewAmount] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newDate, setNewDate] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [newAuthor, setNewAuthor] = useState("Admin");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchExpenses();
    const unsubscribe = setupExpensesRealtime();
    return () => unsubscribe();
  }, [fetchExpenses]);

  // Escape key closes modal
  useEffect(() => {
    if (!showAddModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAddModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAddModal]);

  // KPI Calculations
  const todayTotal = useMemo(() => {
    return expenses
      .filter((e) => {
        try {
          return isToday(new Date(e.created_at));
        } catch {
          return false;
        }
      })
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenses]);

  const todayCount = useMemo(() => {
    return expenses.filter((e) => {
      try {
        return isToday(new Date(e.created_at));
      } catch {
        return false;
      }
    }).length;
  }, [expenses]);

  const monthTotal = useMemo(() => {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    return expenses
      .filter((e) => {
        try {
          const d = new Date(e.created_at);
          return isWithinInterval(d, { start, end });
        } catch {
          return false;
        }
      })
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenses]);

  // Filtered expenses based on period, custom date, and search query
  const filteredExpenses = useMemo(() => {
    const now = new Date();

    return expenses.filter((e) => {
      const expDate = new Date(e.created_at);

      // Period match
      let matchesPeriod = true;
      if (period === "today") {
        matchesPeriod = isToday(expDate);
      } else if (period === "yesterday") {
        matchesPeriod = isYesterday(expDate);
      } else if (period === "week") {
        matchesPeriod = expDate >= subDays(now, 7);
      } else if (period === "month") {
        const start = startOfMonth(now);
        const end = endOfMonth(now);
        matchesPeriod = isWithinInterval(expDate, { start, end });
      } else if (period === "custom") {
        matchesPeriod = format(expDate, "yyyy-MM-dd") === customDate;
      } else if (period === "all") {
        matchesPeriod = true;
      }

      if (!matchesPeriod) return false;

      // Search match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const reasonMatch = e.reason.toLowerCase().includes(q);
        const userMatch = (e.created_by || "").toLowerCase().includes(q);
        const amountMatch = String(e.amount).includes(q);
        if (!reasonMatch && !userMatch && !amountMatch) return false;
      }

      return true;
    });
  }, [expenses, period, customDate, searchQuery]);

  const selectedTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [filteredExpenses]);

  // Handle Add Expense
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(newAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Veuillez saisir un montant valide");
      return;
    }
    if (!newReason.trim()) {
      toast.error("Veuillez renseigner le motif de la dépense");
      return;
    }

    setSubmitting(true);
    try {
      const dateIso = newDate ? new Date(newDate).toISOString() : new Date().toISOString();
      await addExpense(parsedAmount, newReason.trim(), dateIso, newAuthor.trim() || "Admin");
      toast.success(`Dépense de ${parsedAmount.toLocaleString("fr-FR")} DA enregistrée`, {
        description: newReason.trim(),
      });
      setNewAmount("");
      setNewReason("");
      setNewDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      setShowAddModal(false);
    } catch {
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (exp: Expense) => {
    if (!confirm(`Supprimer définitivement la dépense de ${exp.amount} DA (${exp.reason}) ?`)) {
      return;
    }
    await deleteExpense(exp.id);
    toast.success("Dépense supprimée avec succès");
  };

  const handleDeleteAll = async () => {
    if (!filteredExpenses.length) return;
    setDeletingAll(true);
    try {
      const ids = filteredExpenses.map((e) => e.id);
      await deleteExpensesBulk(ids);
      toast.success(`${ids.length} dépense${ids.length > 1 ? "s" : ""} supprimée${ids.length > 1 ? "s" : ""} avec succès`);
      setShowDeleteAllModal(false);
    } catch {
      toast.error("Erreur lors de la suppression");
    } finally {
      setDeletingAll(false);
    }
  };

  // Printable Summary
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-3 sm:p-4 md:p-6 font-sans">
      {/* ── HEADER ── */}
      <div className="mb-3 sm:mb-6 flex flex-col gap-2 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Gestion des Dépenses</h2>
            <p className="text-xs text-muted-foreground">
              Suivi et contrôle de toutes les sorties de caisse
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            title="Imprimer le récapitulatif"
          >
            <Printer className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">Imprimer</span>
          </button>

          {filteredExpenses.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDeleteAllModal(true)}
              className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2 text-xs font-semibold text-destructive transition-all hover:bg-destructive/15 active:scale-95"
              title="Supprimer toutes les dépenses filtrées"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Supprimer ({filteredExpenses.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setNewDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-rose-700 active:scale-95 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Nouvelle Dépense
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 landscape:grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-3 sm:mb-6">
        {/* Card 1: Aujourd'hui */}
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Aujourd'hui</span>
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-rose-500/10 text-rose-600">
              <CalendarDays className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1">
            <p className="text-lg sm:text-2xl font-black text-rose-600 dark:text-rose-400">
              {todayTotal.toLocaleString("fr-FR")} <span className="text-xs font-bold">DA</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {todayCount} sortie{todayCount > 1 ? "s" : ""} de caisse
            </p>
          </div>
        </div>

        {/* Card 2: Ce mois-ci */}
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Ce mois-ci</span>
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1">
            <p className="text-lg sm:text-2xl font-black text-foreground">
              {monthTotal.toLocaleString("fr-FR")} <span className="text-xs font-bold">DA</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Cumul mensuel en cours
            </p>
          </div>
        </div>

        {/* Card 3: Période sélectionnée */}
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Filtre</span>
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1">
            <p className="text-lg sm:text-2xl font-black text-foreground">
              {selectedTotal.toLocaleString("fr-FR")} <span className="text-xs font-bold">DA</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {filteredExpenses.length} dépense{filteredExpenses.length > 1 ? "s" : ""} affichée{filteredExpenses.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Card 4: Moyenne */}
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Moyenne / Sortie</span>
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-blue-500/10 text-blue-600">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1">
            <p className="text-lg sm:text-2xl font-black text-foreground">
              {filteredExpenses.length > 0
                ? Math.round(selectedTotal / filteredExpenses.length).toLocaleString("fr-FR")
                : 0}{" "}
              <span className="text-xs font-bold">DA</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Sur la période sélectionnée
            </p>
          </div>
        </div>
      </div>

      {/* ── CONTROLS & FILTERS ── */}
      <div className="mb-3 sm:mb-4 flex flex-col landscape:flex-row md:flex-row gap-2 md:gap-3 items-stretch landscape:items-center md:items-center justify-between rounded-xl border border-border bg-card p-2.5 sm:p-3 shadow-sm">
        {/* Period Pills */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setPeriod("today")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "today"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            onClick={() => setPeriod("yesterday")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "yesterday"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Hier
          </button>
          <button
            type="button"
            onClick={() => setPeriod("week")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "week"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            7 derniers jours
          </button>
          <button
            type="button"
            onClick={() => setPeriod("month")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "month"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Ce mois-ci
          </button>
          <button
            type="button"
            onClick={() => setPeriod("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "all"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Toutes
          </button>
          <button
            type="button"
            onClick={() => setPeriod("custom")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              period === "custom"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Date précise
          </button>
        </div>

        {/* Custom date picker (when custom is selected) + Search input */}
        <div className="flex flex-row items-center gap-2 flex-wrap">
          {period === "custom" && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full sm:w-auto rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium outline-none focus:border-rose-500"
            />
          )}

          <div className="relative w-full sm:w-56 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher (motif, auteur)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs outline-none focus:border-rose-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── EXPENSES TABLE / LIST ── */}
      <div className="flex-1 rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
        {loading && expenses.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Chargement des dépenses…
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground gap-3">
            <ArrowDownCircle className="h-10 w-10 opacity-30 text-rose-500" />
            <div>
              <p className="text-base font-semibold text-foreground">Aucune dépense trouvée</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery
                  ? "Aucun résultat ne correspond à votre recherche."
                  : "Aucune sortie de caisse enregistrée pour la période sélectionnée."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNewDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                setShowAddModal(true);
              }}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter une dépense
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-4">Date & Heure</th>
                  <th className="py-3 px-4">Motif / Description</th>
                  <th className="py-3 px-4">Enregistré par</th>
                  <th className="py-3 px-4 text-right">Montant (DA)</th>
                  <th className="py-3 px-4 text-center w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredExpenses.map((exp) => {
                  let formattedDate = "";
                  try {
                    formattedDate = format(new Date(exp.created_at), "dd MMM yyyy, HH:mm", {
                      locale: fr,
                    });
                  } catch {
                    formattedDate = exp.created_at;
                  }

                  return (
                    <tr
                      key={exp.id}
                      className="group transition-colors hover:bg-muted/30"
                    >
                      <td className="py-3.5 px-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <span>{formattedDate}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-foreground">
                        {exp.reason}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {exp.created_by || "Caisse"}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="inline-flex items-center font-bold text-rose-600 dark:text-rose-400">
                          - {Number(exp.amount).toLocaleString("fr-FR")} DA
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(exp)}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-70 group-hover:opacity-100 mx-auto"
                          title="Supprimer cette dépense"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ADD EXPENSE MODAL ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-150 overflow-y-auto">
          <div
            className="relative flex flex-col w-full max-w-lg my-auto rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5 sm:py-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-500/10 text-rose-600">
                  <Receipt className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Nouvelle Dépense</h3>
                  <p className="text-xs text-muted-foreground">Enregistrer une sortie de caisse</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Fermer (Échap)"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateExpense} className="flex flex-col gap-3 p-4 sm:gap-4 sm:p-5 landscape:grid landscape:grid-cols-2 landscape:gap-x-4">
              {/* Montant */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Montant (DA) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    autoFocus
                    required
                    placeholder="0"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-2xl font-black text-rose-600 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    DA
                  </span>
                </div>

                {/* Quick amount pills */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_AMOUNTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setNewAmount(q.toString())}
                      className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:border-rose-500 hover:bg-rose-500/5 transition-colors"
                    >
                      {q} DA
                    </button>
                  ))}
                  <button
                    key="add-500"
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(newAmount) || 0;
                      setNewAmount((cur + 500).toString());
                    }}
                    className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                  >
                    +500 DA
                  </button>
                </div>
              </div>

              {/* Motif / Raison */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Motif de la dépense <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Achat pain, légumes, etc."
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />

                {/* Suggestions */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewReason(r)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        newReason === r
                          ? "border-rose-500 bg-rose-500/10 text-rose-600 font-semibold"
                          : "border-border bg-background text-foreground hover:border-rose-500 hover:bg-rose-500/5"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date & Auteur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Date & Heure
                  </label>
                  <input
                    type="datetime-local"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-rose-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Enregistré par
                  </label>
                  <input
                    type="text"
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    placeholder="Admin, Caisse..."
                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="landscape:col-span-2 mt-1 sm:mt-2 flex items-center justify-end gap-2 border-t border-border pt-3 sm:pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting || !newAmount}
                  className="flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-rose-700 active:scale-95 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Enregistrer la dépense
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE ALL CONFIRMATION MODAL ── */}
      {showDeleteAllModal && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-150 overflow-y-auto"
          onClick={() => !deletingAll && setShowDeleteAllModal(false)}
        >
          <div
            className="relative flex flex-col w-full max-w-md my-auto rounded-2xl border border-destructive/30 bg-card shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border px-5 py-4 bg-destructive/5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Supprimer les dépenses</h3>
                <p className="text-xs text-muted-foreground">Cette action est irréversible</p>
              </div>
              {!deletingAll && (
                <button
                  type="button"
                  onClick={() => setShowDeleteAllModal(false)}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Body */}
            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm text-foreground">
                Vous êtes sur le point de supprimer définitivement :
              </p>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre</span>
                  <span className="text-sm font-bold text-foreground">
                    {filteredExpenses.length} dépense{filteredExpenses.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Montant total</span>
                  <span className="text-base font-black text-destructive">
                    {selectedTotal.toLocaleString("fr-FR")} DA
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                ⚠️ Cette suppression est permanente et ne peut pas être annulée.
              </p>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3 mt-1">
                <button
                  type="button"
                  disabled={deletingAll}
                  onClick={() => setShowDeleteAllModal(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={deletingAll}
                  onClick={handleDeleteAll}
                  className="flex items-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-destructive/90 active:scale-95 disabled:opacity-50"
                >
                  {deletingAll ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Suppression…</>
                  ) : (
                    <><Trash2 className="h-4 w-4" /> Confirmer la suppression</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
