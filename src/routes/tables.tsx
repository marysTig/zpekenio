import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Armchair, Clock, Ban, Plus } from "lucide-react";
import { Sidebar } from "@/components/pos/Sidebar";
import { MobileBottomNav } from "@/components/pos/MobileBottomNav";
import { TableOrderSidebar } from "@/components/pos/TableOrderSidebar";
import { CheckoutReceiptModal } from "@/components/pos/CheckoutReceiptModal";
import { formatElapsed } from "@/data/tables";
import { formatDA } from "@/data/menu";
import { useTableStore } from "@/lib/tableStore";
import { useTableOrdersStore } from "@/lib/tableOrdersStore";
import { supabase } from "@/lib/supabase";
import { ComponentLoader } from "@/components/ui/PageLoader";
import { usePrinterStore } from "@/lib/printerStore";
import { runCashierReceiptPrint } from "@/lib/cashierPrint";
import { cartSubtotal, type CartItem } from "@/lib/cart";
import { toast } from "sonner";
import { useSessionStore } from "@/lib/authStore";
import { recordZReport } from "@/lib/zReport";
import { type GlobalSupplement } from "@/lib/globalSupplementsStore";
import { playCashSound } from "@/lib/posSounds";

export const Route = createFileRoute("/tables")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      open: search.open as string | undefined,
    }
  },
  head: () => ({
    meta: [{ title: "Sur place — Z-pekenio" }],
  }),
  component: SurPlacePage,
});

function SurPlacePage() {
  const { tables: tableData, loading, updateTable, rooms, addRoom, addTable } = useTableStore();
  const { orders, orderNotes, orderSupplements, clearOrder, _patchOrder, _patchNote, _patchSupplements } = useTableOrdersStore();
  const { printers } = usePrinterStore();
  const currentUser = useSessionStore(s => s.currentUser);

  const search = Route.useSearch();
  const navigate = useNavigate();

  const [activeTable, setActiveTable] = useState<{ id: string; number: number } | null>(null);
  const [checkoutTable, setCheckoutTable] = useState<{ id: string; number: number } | null>(null);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  // Auto-open sidebar if 'open' search param is present
  useEffect(() => {
    if (search.open && tableData.length > 0) {
      const table = tableData.find(t => t.id === search.open);
      if (table && !activeTable) {
        setActiveTable({ id: table.id, number: table.number });
        // Clear the search param so it doesn't reopen if closed
        navigate({ to: "/tables", replace: true });
      }
    }
  }, [search.open, tableData, activeTable, navigate]);

  // Identify or create the "Sur place" room
  const surPlaceRoom = rooms.find(r => r.name.toLowerCase() === "sur place");
  const surPlaceTables = surPlaceRoom 
    ? tableData.filter(t => t.roomId === surPlaceRoom.id && t.status !== "libre") 
    : [];

  // Fetch from Supabase before checkout (prevents race condition)
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
            console.error("[SUR PLACE CHECKOUT] Erreur SELECT table_orders:", error);
            break;
          }

          if (data && data.items && (data.items as CartItem[]).length > 0) {
            console.log("[SUR PLACE CHECKOUT] Items récupérés:", data.items);
            if (mounted) {
              _patchOrder(checkoutTable.id, data.items as CartItem[]);
              _patchNote(checkoutTable.id, data.note || "");
              _patchSupplements(checkoutTable.id, (data.global_supplements || []) as GlobalSupplement[]);
            }
            break;
          } else if (i < retries - 1) {
            console.log(`[SUR PLACE CHECKOUT] Aucun item, retry ${i + 1}/${retries}...`);
            await new Promise(r => setTimeout(r, 800));
          }
        } catch (err) {
          console.error("[SUR PLACE CHECKOUT] Exception:", err);
          break;
        }
      }
    };

    void fetchOrderForCheckout();
    return () => { mounted = false; };
  }, [checkoutTable, _patchOrder, _patchNote, _patchSupplements]);

  const handleCreateOrder = async (type: "sur-place" | "emporter") => {
    setIsCreatingOrder(true);
    try {
      const roomName = type === "sur-place" ? "Sur place" : "Emporter";
      let room = rooms.find(r => r.name.toLowerCase() === roomName.toLowerCase());
      
      if (!room) {
        const newRoomId = await addRoom(roomName);
        room = { id: newRoomId, name: roomName };
      }

      const freeTable = tableData.find(t => t.roomId === room?.id && t.status === "libre");
      let targetTableId = "";
      let targetTableNumber = 0;

      if (freeTable) {
        await updateTable(freeTable.id, {
          status: "occupee",
          occupiedSince: new Date().toISOString(),
          orderTotal: 0
        });
        targetTableId = freeTable.id;
        targetTableNumber = freeTable.number;
      } else {
        const allRoomTables = tableData.filter(t => t.roomId === room?.id);
        const maxNumber = allRoomTables.reduce((max, t) => Math.max(max, t.number), 0);
        const nextNumber = maxNumber + 1;
        
        targetTableId = await addTable({
          number: nextNumber,
          seats: 1,
          status: "occupee",
          roomId: room!.id,
        });
        
        await updateTable(targetTableId, {
          occupiedSince: new Date().toISOString()
        });
        targetTableNumber = nextNumber;
      }

      if (type === "sur-place") {
        setActiveTable({ id: targetTableId, number: targetTableNumber });
      } else {
        navigate({ to: "/emporter", search: { open: targetTableId } });
      }
    } catch (error) {
      console.error("Erreur création commande:", error);
      toast.error("Impossible de créer la commande.");
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const handleCancelOrder = async (id: string) => {
    await updateTable(id, {
      status: "libre",
      orderTotal: 0,
      occupiedSince: null as any,
    });
    clearOrder(id);
  };

  const handleQuickCheckout = async () => {
    if (!checkoutTable) return;
    
    const itemsToPrint = orders[checkoutTable.id] || [];
    const supplementsToPrint = orderSupplements[checkoutTable.id] || [];

    if (itemsToPrint.length === 0) {
      toast.error("Impossible d'encaisser : la commande est vide.", { duration: 5000 });
      return;
    }

    try {
      await recordZReport(itemsToPrint, "table", checkoutTable.number, supplementsToPrint);
    } catch (err) {
      console.error("[SUR PLACE CHECKOUT] Z Report a échoué:", err);
      toast.error("Erreur d'enregistrement du Rapport Z.", { duration: 7000 });
      return; 
    }

    playCashSound();
    clearOrder(checkoutTable.id);
    await updateTable(checkoutTable.id, {
      status: "libre",
      orderTotal: 0,
      occupiedSince: null as any,
    });
    
    await runCashierReceiptPrint({
      printers,
      items: itemsToPrint,
      total: cartSubtotal(itemsToPrint),
      label: `SUR PLACE — Ticket #${checkoutTable.number}`,
      globalSupplements: supplementsToPrint,
      tableId: checkoutTable.id,
    });

    setCheckoutTable(null);
  };

  const checkoutItems = checkoutTable ? (orders[checkoutTable.id] ?? []) : [];
  const checkoutNote = checkoutTable ? (orderNotes[checkoutTable.id] ?? undefined) : undefined;
  const checkoutSupplements = checkoutTable ? (orderSupplements[checkoutTable.id] ?? []) : [];

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans">
      <Sidebar activePage="tables" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Armchair className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Sur place</h1>
              <p className="text-xs text-muted-foreground">Commandes en salle</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleCreateOrder("sur-place")}
              disabled={isCreatingOrder}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
            >
              <Plus className="h-4 w-4 hidden sm:block" />
              Sur Place
            </button>
            <button
              onClick={() => handleCreateOrder("emporter")}
              disabled={isCreatingOrder}
              className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-700 active:scale-95 disabled:opacity-50"
            >
              <Plus className="h-4 w-4 hidden sm:block" />
              À Emporter
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          {loading ? (
            <ComponentLoader />
          ) : surPlaceTables.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <p className="text-sm font-semibold text-foreground">Aucune commande sur place en cours</p>
              <p className="mt-1 text-xs text-muted-foreground">Cliquez sur "Nouvelle Commande" pour commencer.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {surPlaceTables.map(table => (
                <div
                  key={table.id}
                  onClick={() => setActiveTable({ id: table.id, number: table.number })}
                  className="relative flex cursor-pointer flex-col gap-2 rounded-3xl border-2 border-b-[6px] border-emerald-300 bg-emerald-100 p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:translate-y-1 active:border-b-[2px] active:scale-[0.98] dark:border-emerald-700 dark:bg-emerald-950/60"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">Ticket</p>
                      <p className="text-2xl font-extrabold text-foreground leading-none mt-0.5">#{table.number}</p>
                    </div>
                    <span className="shrink-0 flex items-center gap-1.5 rounded-full border-2 border-emerald-300 bg-white/80 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-700 dark:bg-black/40 dark:text-emerald-400">
                      <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      En cours
                    </span>
                  </div>

                  {table.occupiedSince && (
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded-md">
                        <Clock className="shrink-0 h-3.5 w-3.5" />
                        <span className="whitespace-nowrap font-medium">{formatElapsed(table.occupiedSince)}</span>
                      </div>
                      {table.orderTotal !== undefined && table.orderTotal > 0 && (
                        <p className="whitespace-nowrap text-sm font-bold text-foreground bg-primary/10 text-primary px-2 py-1 rounded-md">
                          {formatDA(table.orderTotal)}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    {currentUser?.role !== 'serveur' && (
                      <button
                        onClick={() => setCheckoutTable({ id: table.id, number: table.number })}
                        className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700 active:scale-95"
                      >
                        Encaisser
                      </button>
                    )}
                    <button
                      onClick={() => handleCancelOrder(table.id)}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-destructive active:scale-95"
                      title="Annuler (Libérer)"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <MobileBottomNav activePage="tables" />

      {activeTable && (
        <TableOrderSidebar
          tableId={activeTable.id}
          tableNumber={activeTable.number}
          onClose={() => setActiveTable(null)}
        />
      )}

      <CheckoutReceiptModal
        open={checkoutTable !== null}
        tableNumber={`SUR PLACE — Ticket #${checkoutTable?.number}`}
        items={checkoutItems}
        {...(checkoutNote ? { orderNote: checkoutNote } : {})}
        globalSupplements={checkoutSupplements}
        onClose={() => setCheckoutTable(null)}
        onConfirm={handleQuickCheckout}
      />
    </div>
  );
}
