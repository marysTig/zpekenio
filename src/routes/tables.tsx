import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Armchair, Clock, Ban, ShoppingBag, Merge, Check, X
} from "lucide-react";
import { Sidebar } from "@/components/pos/Sidebar";
import { MobileBottomNav } from "@/components/pos/MobileBottomNav";
import { TableOrderSidebar } from "@/components/pos/TableOrderSidebar";
import { CheckoutReceiptModal } from "@/components/pos/CheckoutReceiptModal";
import { formatElapsed, type TableStatus } from "@/data/tables";
import { formatDA } from "@/data/menu";
import { useTableStore, type TableItem } from "@/lib/tableStore";
import { useTableOrdersStore } from "@/lib/tableOrdersStore";
import { useSessionStore } from "@/lib/authStore";
import { usePrinterStore } from "@/lib/printerStore";
import { runCashierReceiptPrint } from "@/lib/cashierPrint";
import { supabase } from "@/lib/supabase";
import { cartSubtotal, type CartItem } from "@/lib/cart";
import { toast } from "sonner";
import { UserLogin } from "@/components/auth/UserLogin";
import { ComponentLoader } from "@/components/ui/PageLoader";
import { recordZReport } from "@/lib/zReport";
import { type GlobalSupplement } from "@/lib/globalSupplementsStore";
import { playCashSound } from "@/lib/posSounds";

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [{ title: "Tables — Z-pekenio" }],
  }),
  component: TablesPage,
});

// ─── Status config ────────────────────────────────────────────────────────────
const statusConfig: Record<TableStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  libre:    { label: "Libre",     color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-950/60", border: "border-emerald-300 dark:border-emerald-700", dot: "bg-emerald-500" },
  occupee:  { label: "Occupée",  color: "text-orange-700 dark:text-orange-400",   bg: "bg-orange-100 dark:bg-orange-950/60",   border: "border-orange-300 dark:border-orange-700",   dot: "bg-orange-500" },
  reservee: { label: "Réservée", color: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-100 dark:bg-blue-950/60",       border: "border-blue-300 dark:border-blue-700",       dot: "bg-blue-500"   },
};

const filters: { label: string; value: TableStatus | "toutes" }[] = [
  { label: "Toutes",    value: "toutes"   },
  { label: "Libres",    value: "libre"    },
  { label: "Occupées",  value: "occupee"  },
  { label: "Réservées", value: "reservee" },
];

// ─── TableCard ────────────────────────────────────────────────────────────────
function TableCard({
  table, isActive, onStatusChange, onSelect, onEncaisser, isMergingMode, isSelectedForMerge, mergedWithNumbers, isServeur
}: {
  table: TableItem;
  isActive: boolean;
  onStatusChange: (id: string, status: TableStatus) => void;
  onSelect: (id: string, number: number) => void;
  onEncaisser: (id: string, number: number) => void;
  isMergingMode?: boolean;
  isSelectedForMerge?: boolean;
  mergedWithNumbers?: string | undefined;
  isServeur?: boolean | undefined;
}) {
  const cfg = statusConfig[table.status];
  return (
    <div
      data-table-id={table.id}
      onClick={() => onSelect(table.id, table.number)}
      className={`relative flex cursor-pointer flex-col gap-2 rounded-3xl border-2 border-b-[6px] p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:translate-y-1 active:border-b-[2px] active:scale-[0.98]
        ${cfg.bg} ${cfg.border}
        ${isActive ? "ring-4 ring-primary ring-offset-2 shadow-lg border-b-[4px] -translate-y-0.5" : "shadow-sm"}
        ${isSelectedForMerge ? "ring-4 ring-blue-500 ring-offset-2 shadow-lg border-blue-500 bg-blue-50 dark:bg-blue-900/30" : ""}`}
    >
      {/* If merging mode, hide the action buttons and optionally show a check icon if selected */}
      {isMergingMode && isSelectedForMerge && (
        <div className="absolute right-3 top-3 rounded-full bg-blue-500 p-1 text-white shadow-md">
          <Check className="h-4 w-4" />
        </div>
      )}
      {/* Number + status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Table</p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-2xl font-extrabold text-foreground leading-none mt-0.5">{table.number}</p>
            {mergedWithNumbers && (
              <span className="shrink-0 whitespace-nowrap text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200" title="Table fusionnée">
                F {mergedWithNumbers}
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold bg-white/80 dark:bg-black/40 ${cfg.color} ${cfg.border}`}>
          <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          <span className="whitespace-nowrap">{cfg.label}</span>
        </span>
      </div>


      {/* Occupied info */}
      {table.status === "occupee" && table.occupiedSince && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-md">
            <Clock className="shrink-0 h-3.5 w-3.5" />
            <span className="whitespace-nowrap font-medium">{formatElapsed(table.occupiedSince)}</span>
          </div>
          {table.orderTotal !== undefined && (
            <p className="whitespace-nowrap text-sm font-bold text-foreground bg-primary/10 text-primary px-2 py-1 rounded-md">
              {formatDA(table.orderTotal)}
            </p>
          )}
        </div>
      )}

      {/* Actions (stop propagation so clicks don't trigger onSelect) */}
      {!isMergingMode && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
          {table.status === "libre" && (
            <button
              onClick={() => onStatusChange(table.id, "reservee")}
              className="flex-1 rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 active:scale-95 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
            >
              Réserver
            </button>
          )}
          {table.status === "occupee" && (
            <>
              {!isServeur && (
                <button
                  onClick={() => onEncaisser(table.id, table.number)}
                  className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 active:scale-95"
                >
                  Encaisser
                </button>
              )}
              <button
                onClick={() => onStatusChange(table.id, "libre")}
                className={`${isServeur ? 'flex-1 flex justify-center items-center ' : ''}rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-destructive active:scale-95`}
                title="Libérer sans récapitulatif"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {table.status === "reservee" && (
            <>
              <button
                onClick={() => onStatusChange(table.id, "occupee")}
                className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 active:scale-95"
              >
                Placer
              </button>
              <button
                onClick={() => onStatusChange(table.id, "libre")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-destructive active:scale-95"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── MergedTableLines (SVG Overlay) ────────────────────────────────────────────
function MergedTableLines({ tables }: { tables: TableItem[] }) {
  const [lines, setLines] = useState<{ id: string; x1: number; y1: number; x2: number; y2: number }[]>([]);

  useEffect(() => {
    const updateLines = () => {
      const newLines: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
      const container = document.querySelector('main');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();

      tables.forEach(table => {
        if (table.parentTableId) {
          const childEl = document.querySelector(`[data-table-id="${table.id}"]`);
          const parentEl = document.querySelector(`[data-table-id="${table.parentTableId}"]`);

          if (childEl && parentEl) {
            const childRect = childEl.getBoundingClientRect();
            const parentRect = parentEl.getBoundingClientRect();

            // Calculate center relative to the container's top-left, factoring in scroll
            const childX = childRect.left - containerRect.left + childRect.width / 2 + container.scrollLeft;
            const childY = childRect.top - containerRect.top + childRect.height / 2 + container.scrollTop;

            const parentX = parentRect.left - containerRect.left + parentRect.width / 2 + container.scrollLeft;
            const parentY = parentRect.top - containerRect.top + parentRect.height / 2 + container.scrollTop;

            newLines.push({ id: table.id, x1: parentX, y1: parentY, x2: childX, y2: childY });
          }
        }
      });
      setLines(newLines);
    };

    // Use a small delay for initial render to ensure DOM is ready
    const timer = setTimeout(updateLines, 50);
    window.addEventListener('resize', updateLines);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateLines);
    };
  }, [tables]);

  if (lines.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" style={{ overflow: 'visible' }}>
      {lines.map((line) => (
        <line
          key={line.id}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          className="text-blue-500 opacity-60"
        />
      ))}
    </svg>
  );
}

// ── TablesPage ───────────────────────────────────────────────────────────────
function TablesPage() {
  const { tables: tableData, loading: tablesLoading, updateTable, rooms, addRoom, addTable, mergeTablesDB } = useTableStore();
  const { orders, orderNotes, orderSupplements, clearOrder, mergeOrders, _patchOrder, _patchNote, _patchSupplements } = useTableOrdersStore();
  const currentUser = useSessionStore((s) => s.currentUser);
  const { printers } = usePrinterStore();

  const [filter, setFilter]           = useState<TableStatus | "toutes">("toutes");
  const [activeTable, setActiveTable] = useState<{ id: string; number: number; mergedIds?: string[] } | null>(null);

  // ── Encaissement rapide depuis la carte table
  const [checkoutTable, setCheckoutTable] = useState<{ id: string; number: number } | null>(null);
  const [multiCheckoutTables, setMultiCheckoutTables] = useState<string[]>([]);

  // ── Fusion state
  const [isMerging, setIsMerging] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [isCreatingTakeaway, setIsCreatingTakeaway] = useState(false);
  const [isFetchingOrder, setIsFetchingOrder] = useState(false);

  // ── Fetch table_orders depuis Supabase quand la caisse ouvre un modal d'encaissement
  // Corrige le bug : la caisse ouvre CheckoutReceiptModal sans passer par TableOrderSidebar,
  // donc le store Zustand peut ne pas avoir les items si le Realtime n'a pas livré l'event.
  useEffect(() => {
    if (!checkoutTable) return;
    let mounted = true;

    const fetchOrderForCheckout = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        if (!mounted) return;
        try {
          const { data, error } = await supabase
            .from("table_orders")
            .select("items, note, global_supplements")
            .eq("table_id", checkoutTable.id)
            .maybeSingle();

          if (error) {
            console.error("[CASHIER CHECKOUT] Erreur SELECT table_orders:", error);
            break;
          }

          if (data && data.items && (data.items as CartItem[]).length > 0) {
            console.log("[CASHIER CHECKOUT] Items recupérés:", data.items);
            if (mounted) {
              _patchOrder(checkoutTable.id, data.items as CartItem[]);
              _patchNote(checkoutTable.id, data.note || "");
              _patchSupplements(checkoutTable.id, (data.global_supplements || []) as GlobalSupplement[]);
            }
            break;
          } else if (i < retries - 1) {
            console.log(`[CASHIER CHECKOUT] Aucun item, retry ${i + 1}/${retries}...`);
            await new Promise(r => setTimeout(r, 800));
          }
        } catch (err) {
          console.error("[CASHIER CHECKOUT] Exception:", err);
          break;
        }
      }
    };

    setIsFetchingOrder(true);
    void fetchOrderForCheckout().finally(() => setIsFetchingOrder(false));
    return () => { mounted = false; };
  }, [checkoutTable, _patchOrder, _patchNote, _patchSupplements]);

  const emporterRoom = rooms.find(r => r.name.toLowerCase() === "emporter");
  const regularTables = tableData.filter(t => !emporterRoom || t.roomId !== emporterRoom.id);
  const emporterTables = emporterRoom ? tableData.filter(t => t.roomId === emporterRoom.id) : [];
  const activeEmporterCount = emporterTables.filter(t => t.status !== "libre").length;

  const libre    = regularTables.filter(t => t.status === "libre").length;
  const occupee  = regularTables.filter(t => t.status === "occupee").length;
  const reservee = regularTables.filter(t => t.status === "reservee").length;
  const visible  = filter === "toutes" ? regularTables : regularTables.filter(t => t.status === filter);

  const handleTakeawayClick = async () => {
    setIsCreatingTakeaway(true);
    try {
      let roomId = emporterRoom?.id;
      if (!roomId) {
        roomId = await addRoom("Emporter");
      }

      // Chercher une table libre existante
      const freeTable = tableData.find(t => t.roomId === roomId && t.status === "libre");
      if (freeTable) {
        setActiveTable({ id: freeTable.id, number: freeTable.number });
      } else {
        // Créer une nouvelle commande à emporter
        const nextNumber = emporterTables.length + 1;
        const newTableId = await addTable({
          number: nextNumber,
          seats: 1,
          status: "libre",
          roomId,
        });
        setActiveTable({ id: newTableId, number: nextNumber });
      }
    } catch (error) {
      console.error("Erreur création emporter:", error);
    } finally {
      setIsCreatingTakeaway(false);
    }
  };

  const handleStatusChange = useCallback(async (id: string, status: TableStatus) => {
    const payload: Partial<TableItem> = { status };
    if (status === "occupee") {
      payload.occupiedSince = new Date().toISOString();
      payload.orderTotal = 0;
    } else {
      payload.occupiedSince = null as any;
      payload.orderTotal = 0;
      payload.parentTableId = null;
    }
    await updateTable(id, payload);

    // If freeing a table, also free its merged children
    if (status === "libre") {
      const children = tableData.filter(t => t.parentTableId === id);
      for (const child of children) {
        await updateTable(child.id, {
          status: "libre",
          occupiedSince: null as any,
          orderTotal: 0,
          parentTableId: null
        });
      }
    }
  }, [updateTable, tableData]);

  // ── Table selection → ouvre directement la modal ou gère la fusion
  const handleSelectTable = useCallback((id: string, number: number) => {
    if (isMerging) {
      setSelectedTables((prev) => 
        prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
      );
      return;
    }

    const clickedTable = tableData.find(t => t.id === id);
    if (!clickedTable) return;

    let targetId = id;
    let targetNumber = number;

    if (clickedTable.parentTableId) {
      const parent = tableData.find(t => t.id === clickedTable.parentTableId);
      if (parent) {
        targetId = parent.id;
        targetNumber = parent.number;
      }
    }

    const mergedChildren = tableData.filter(t => t.parentTableId === targetId);
    const mergedIds = mergedChildren.map(t => t.id);

    if (activeTable?.id === targetId) {
      setActiveTable(null);
    } else {
      setActiveTable({ id: targetId, number: targetNumber, mergedIds });
    }
  }, [isMerging, tableData, activeTable]);

  const handleCheckoutClick = useCallback((id: string, number: number) => {
    const clickedTable = tableData.find(t => t.id === id);
    if (!clickedTable) return;

    let targetId = id;
    let targetNumber = number;

    if (clickedTable.parentTableId) {
      const parent = tableData.find(t => t.id === clickedTable.parentTableId);
      if (parent) {
        targetId = parent.id;
        targetNumber = parent.number;
      }
    }

    setCheckoutTable({ id: targetId, number: targetNumber });
  }, [tableData]);

  const handleConfirmMerge = async () => {
    if (selectedTables.length < 2) return;
    const [primaryId, ...otherIds] = selectedTables;
    if (!primaryId) return;
    
    const primaryTable = tableData.find(t => t.id === primaryId);
    
    // 1. Move items locally
    mergeOrders(primaryId, otherIds);
    
    // 2. Sum up total amounts
    const otherTables = tableData.filter(t => otherIds.includes(t.id));
    const totalAmountToAdd = otherTables.reduce((sum, t) => sum + (t.orderTotal || 0), 0);
    
    // 3. Update DB
    await mergeTablesDB(primaryId, otherIds, totalAmountToAdd);
    
    setIsMerging(false);
    setSelectedTables([]);

    // Open the sidebar for the combined tables
    if (primaryTable) {
      setActiveTable({ id: primaryId, number: primaryTable.number, mergedIds: otherIds });
    }
  };

  const closePanel = () => setActiveTable(null);

  // ── Confirmation d'encaissement depuis la carte table
  const handleQuickCheckout = async () => {
    if (!checkoutTable) return;

    // Snapshot des items AVANT clearOrder
    const allIds = [checkoutTable.id, ...multiCheckoutTables];
    const itemsToPrint = allIds.flatMap(id => orders[id] ?? []);
    const supplementsToPrint = allIds.flatMap(id => orderSupplements[id] ?? []);
    const totalToPrint = cartSubtotal(itemsToPrint);
    const tableNumber = checkoutTable.number;
    let tableNumberStr = String(tableNumber);
    if (multiCheckoutTables.length > 0) {
      const numbers = tableData.filter(t => multiCheckoutTables.includes(t.id)).map(t => t.number).join(", ");
      tableNumberStr = `Tables ${numbers}`;
    }

    // Guard: ne pas encaisser si les items sont vides (race condition Supabase/Zustand)
    if (itemsToPrint.length === 0) {
      toast.error("Commande vide — veuillez patienter un instant et réessayer.", { duration: 5000 });
      return;
    }

    // Enregistrer dans l'historique du Rapport Z (supplements are embedded in each item)
    // Si le Z Report échoue, on arrête ici pour ne pas perdre la vente.
    try {
      await recordZReport(itemsToPrint, "table", tableNumberStr, []);
    } catch (err) {
      console.error("[TABLE CHECKOUT] Z Report a échoué — paiement annulé:", err);
      toast.error("Erreur d'enregistrement du Rapport Z. Paiement non finalisé.", { duration: 7000 });
      setCheckoutTable(null);
      return;
    }

    playCashSound();

    const checkoutTableId = checkoutTable.id;
    clearOrder(checkoutTable.id);
    await updateTable(checkoutTable.id, {
      status: "libre",
      orderTotal: 0,
      occupiedSince: null as any,
      parentTableId: null,
    });
    
    // Free merged children as well
    const children = tableData.filter(t => t.parentTableId === checkoutTable.id);
    for (const child of children) {
      await updateTable(child.id, {
        status: "libre",
        occupiedSince: null as any,
        orderTotal: 0,
        parentTableId: null
      });
    }
    
    if (multiCheckoutTables.length > 0) {
      for (const id of multiCheckoutTables) {
        clearOrder(id);
        await updateTable(id, {
          status: "libre",
          orderTotal: 0,
          occupiedSince: null as any,
          parentTableId: null,
        });
        
        const children = tableData.filter(t => t.parentTableId === id);
        for (const child of children) {
          await updateTable(child.id, {
            status: "libre",
            occupiedSince: null as any,
            orderTotal: 0,
            parentTableId: null
          });
        }
      }
      setMultiCheckoutTables([]);
      setIsMerging(false);
      setSelectedTables([]);
    }

    setCheckoutTable(null);

    // --- IMPRESSION CAISSE (file d'attente — pas d'attente Bluetooth) ---
    await runCashierReceiptPrint({
      printers,
      items: itemsToPrint,
      total: totalToPrint,
      label: tableNumberStr,
      globalSupplements: supplementsToPrint,
      tableId: checkoutTableId,
    });
    // -------------------------
  };

  const handleMultiCheckoutClick = () => {
    setMultiCheckoutTables(selectedTables);
  };

  // ── Computed for CheckoutReceiptModal
  let checkoutItems = checkoutTable ? (orders[checkoutTable.id] ?? []) : [];
  let checkoutNote = checkoutTable ? (orderNotes[checkoutTable.id] ?? undefined) : undefined;
  let checkoutSupplements = checkoutTable ? (orderSupplements[checkoutTable.id] ?? []) : [];
  let checkoutTableNumber: string | number = checkoutTable?.number ?? 0;

  if (multiCheckoutTables.length > 0) {
    const combinedItems: any[] = [];
    const notes: string[] = [];
    const combinedSupplements: any[] = [];
    multiCheckoutTables.forEach(id => {
      if (orders[id]) combinedItems.push(...orders[id]);
      if (orderNotes[id]) notes.push(orderNotes[id]);
      if (orderSupplements[id]) combinedSupplements.push(...orderSupplements[id]);
    });
    checkoutItems = combinedItems;
    checkoutNote = notes.length > 0 ? notes.join(" | ") : undefined;
    checkoutSupplements = combinedSupplements;
    const numbers = tableData
      .filter(t => multiCheckoutTables.includes(t.id))
      .map(t => t.number)
      .join(", ");
    checkoutTableNumber = `Tables ${numbers}`;
  }


  // Show login screen if no user is authenticated
  if (!currentUser) {
    return <UserLogin />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans">
      <Sidebar activePage="tables" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Header */}
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Armchair className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Tables</h1>
            <p className="text-xs text-muted-foreground">Plan de salle</p>
          </div>
        </header>

        {/* Actions (À emporter + Fusionner) */}
        <div className="shrink-0 grid grid-cols-2 gap-3 border-b border-border bg-card px-4 py-3">
          <button
            onClick={handleTakeawayClick}
            disabled={isCreatingTakeaway}
            className="relative flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 transition-all hover:bg-orange-100 active:scale-[0.99] dark:border-orange-800 dark:bg-orange-950/40 disabled:opacity-50 disabled:cursor-wait"
          >
            <ShoppingBag className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            <span className="text-sm font-bold text-orange-700 dark:text-orange-400">À emporter</span>
            {activeEmporterCount > 0 && (
              <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-600 text-xs font-bold text-white shadow-sm ring-2 ring-background">
                {activeEmporterCount}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setIsMerging(!isMerging);
              setSelectedTables([]);
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 transition-all active:scale-[0.99] ${
              isMerging 
                ? "border-primary bg-primary/10 text-primary ring-2 ring-primary" 
                : "border-border bg-background hover:bg-muted text-foreground"
            }`}
          >
            <Merge className="h-5 w-5" />
            <span className="text-sm font-bold">{isMerging ? "Annuler Sélection" : "Sélection Multiple"}</span>
          </button>
        </div>

        {/* Filters & Stats */}
        <div className="flex shrink-0 justify-start md:justify-center gap-2 overflow-x-auto border-b border-border bg-card px-4 pb-3 pt-3 [&::-webkit-scrollbar]:hidden">
          {filters.map(f => {
            const count = 
              f.value === 'toutes' ? regularTables.length : 
              f.value === 'libre' ? libre : 
              f.value === 'occupee' ? occupee : 
              reservee;
            
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  filter === f.value 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <span>{f.label}</span>
                <span 
                  className={`flex h-5 items-center justify-center rounded-full px-2 text-[10px] ${
                    filter === f.value 
                      ? "bg-background/20 text-primary-foreground" 
                      : "bg-background text-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table grid */}
        <main className="relative flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          <MergedTableLines tables={visible} />
          {tablesLoading ? (
            <ComponentLoader />
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <p className="text-sm font-semibold text-foreground">Aucune table</p>
              <p className="mt-1 text-xs text-muted-foreground">Ajoutez des tables depuis le panneau admin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map(table => {
                let mergedWithNumbers: string | undefined;
                if (table.parentTableId) {
                  const parent = tableData.find(t => t.id === table.parentTableId);
                  if (parent) mergedWithNumbers = `${parent.number}`;
                } else {
                  const children = tableData.filter(t => t.parentTableId === table.id);
                  if (children.length > 0) {
                    mergedWithNumbers = children.map(t => t.number).join(", ");
                  }
                }

                return (
                  <TableCard
                    key={table.id}
                    table={table}
                    isActive={activeTable?.id === table.id}
                    onStatusChange={handleStatusChange}
                    onSelect={handleSelectTable}
                    onEncaisser={handleCheckoutClick}
                    isMergingMode={isMerging}
                    isSelectedForMerge={selectedTables.includes(table.id)}
                    mergedWithNumbers={mergedWithNumbers}
                    isServeur={currentUser?.role === 'serveur'}
                  />
                );
              })}
            </div>
          )}

        </main>
        
        {/* Barre de commande de sélection multiple */}
        {isMerging && (
          <div className="shrink-0 border-t border-border bg-card p-4 pb-24 md:pb-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="font-bold text-foreground text-base sm:text-lg">
                Sélection ({selectedTables.length})
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Total: <span className="font-semibold text-primary">{formatDA(selectedTables.reduce((sum, id) => {
                  const t = tableData.find(tb => tb.id === id);
                  return sum + (t?.orderTotal || 0);
                }, 0))}</span>
              </p>
            </div>
            
            <div className="flex flex-row gap-2 w-full sm:w-auto">
              {selectedTables.length >= 2 && (
                <button
                  onClick={handleConfirmMerge}
                  className="flex-1 sm:flex-none rounded-lg bg-blue-600 px-3 sm:px-6 py-2.5 text-xs sm:text-sm font-bold text-white transition-all hover:bg-blue-700 active:scale-95 shadow-sm"
                >
                  <span className="sm:hidden">Fusionner</span>
                  <span className="hidden sm:inline">Fusionner pour commander</span>
                </button>
              )}
              {selectedTables.length > 0 && currentUser?.role !== 'serveur' && (
                <button
                  onClick={handleMultiCheckoutClick}
                  className="flex-1 sm:flex-none rounded-lg bg-emerald-600 px-3 sm:px-6 py-2.5 text-xs sm:text-sm font-bold text-white transition-all hover:bg-emerald-700 active:scale-95 shadow-sm"
                >
                  <span className="sm:hidden">Encaisser</span>
                  <span className="hidden sm:inline">Encaisser la sélection</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <MobileBottomNav activePage="tables" />

      {/* Modal plein-écran avec catégories + produits + panier */}
      {activeTable && (
        <TableOrderSidebar
          key={activeTable.id}
          tableId={activeTable.id}
          tableNumber={activeTable.number}
          mergedIds={activeTable.mergedIds}
          onClose={closePanel}
        />
      )}

      {/* Modal de récapitulatif avant encaissement */}
      <CheckoutReceiptModal
        open={checkoutTable !== null || multiCheckoutTables.length > 0}
        tableNumber={checkoutTableNumber}
        items={checkoutItems}
        {...(checkoutNote ? { orderNote: checkoutNote } : {})}
        globalSupplements={checkoutSupplements}
        onClose={() => {
          setCheckoutTable(null);
          setMultiCheckoutTables([]);
        }}
        onConfirm={handleQuickCheckout}
        isLoading={isFetchingOrder}
      />
    </div>
  );
}
