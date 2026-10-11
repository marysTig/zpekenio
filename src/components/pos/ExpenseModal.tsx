import { useState, useEffect, useMemo } from "react";
import { X, Receipt, Trash2, Plus, Loader2, ArrowDownCircle, History, Check } from "lucide-react";
import { format, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { useExpensesStore } from "@/lib/expensesStore";

interface ExpenseModalProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_REASONS = [
  "Pain",
  "Légumes",
  "Boissons",
  "Courses",
  "Gaz",
  "Entretien",
  "Glace",
  "Autre",
];

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000];

export function ExpenseModal({ open, onClose }: ExpenseModalProps) {
  const { expenses, loading, fetchExpenses, addExpense, deleteExpense } = useExpensesStore();

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"new" | "history">("new");

  useEffect(() => {
    if (open) {
      fetchExpenses();
      setAmount("");
      setReason("");
      setActiveTab("new");
    }
  }, [open, fetchExpenses]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Today's expenses
  const todayExpenses = useMemo(() => {
    return expenses.filter((e) => {
      try {
        return isToday(new Date(e.created_at));
      } catch {
        return false;
      }
    });
  }, [expenses]);

  const todayTotal = useMemo(() => {
    return todayExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [todayExpenses]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Veuillez saisir un montant valide");
      return;
    }
    if (!reason.trim()) {
      toast.error("Veuillez renseigner le motif de la dépense");
      return;
    }

    setSubmitting(true);
    try {
      await addExpense(parsedAmount, reason.trim());
      toast.success(`Dépense de ${parsedAmount.toLocaleString("fr-FR")} DA enregistrée`, {
        description: reason.trim(),
      });
      setAmount("");
      setReason("");
      setActiveTab("history");
    } catch {
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, expReason: string, expAmount: number) => {
    if (!confirm(`Supprimer la dépense de ${expAmount} DA (${expReason}) ?`)) return;
    await deleteExpense(id);
    toast.success("Dépense supprimée");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        className="relative flex flex-col w-full max-w-lg max-h-[90vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Dépenses de Caisse</h2>
              <p className="text-xs text-muted-foreground">Enregistrer une sortie d'argent</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Fermer (Échap)"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab switch & Daily summary badge */}
        <div className="flex items-center justify-between border-b border-border bg-background/50 px-5 py-2.5">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setActiveTab("new")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "new"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle dépense
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "history"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              Historique du jour
              {todayExpenses.length > 0 && (
                <span className="ml-1 rounded-full bg-rose-500/15 px-1.5 py-0.2 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                  {todayExpenses.length}
                </span>
              )}
            </button>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Total jour</span>
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
              {todayTotal.toLocaleString("fr-FR")} DA
            </p>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "new" ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-xl font-bold outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    DA
                  </span>
                </div>

                {/* Quick amount shortcuts */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_AMOUNTS.map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      onClick={() => setAmount(quick.toString())}
                      className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:border-rose-500 hover:bg-rose-500/5 transition-colors"
                    >
                      {quick} DA
                    </button>
                  ))}
                  <button
                    key="add-more"
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(amount) || 0;
                      setAmount((cur + 500).toString());
                    }}
                    className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                  >
                    +500 DA
                  </button>
                </div>
              </div>

              {/* Motif / Raison */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Motif / Raison <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Achat pain, légumes, etc."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />

                {/* Quick reason suggestions */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        reason === r
                          ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold"
                          : "border-border bg-card text-foreground hover:border-rose-500 hover:bg-rose-500/5"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={submitting || !amount}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-rose-700 active:scale-95 disabled:opacity-50"
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
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              {todayExpenses.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                  <ArrowDownCircle className="h-8 w-8 opacity-30" />
                  <p className="text-sm font-medium">Aucune dépense enregistrée aujourd'hui</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("new")}
                    className="mt-1 text-xs font-semibold text-rose-600 hover:underline"
                  >
                    + Ajouter une dépense
                  </button>
                </div>
              ) : (
                todayExpenses.map((exp) => {
                  let timeFormatted = "";
                  try {
                    timeFormatted = format(new Date(exp.created_at), "HH:mm", { locale: fr });
                  } catch {
                    timeFormatted = "";
                  }
                  return (
                    <div
                      key={exp.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-border/80"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-600 font-bold text-xs">
                          {timeFormatted || "•"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{exp.reason}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {exp.created_by ? `Par ${exp.created_by}` : "Caisse"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold text-rose-600 dark:text-rose-400">
                          - {Number(exp.amount).toLocaleString("fr-FR")} DA
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(exp.id, exp.reason, Number(exp.amount))}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Supprimer la dépense"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
