import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "@/components/pos/Sidebar";
import { MobileBottomNav } from "@/components/pos/MobileBottomNav";
import { Armchair, ShoppingBag, Plus } from "lucide-react";
import { useTableStore } from "@/lib/tableStore";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Caisse — Z-pekenio" }],
  }),
  component: CaisseHome,
});

function CaisseHome() {
  const navigate = useNavigate();
  const { tables, rooms, addRoom, addTable, updateTable } = useTableStore();
  const [loadingType, setLoadingType] = useState<"sur-place" | "emporter" | null>(null);

  const createAndNavigate = async (type: "sur-place" | "emporter") => {
    setLoadingType(type);
    try {
      const roomName = type === "sur-place" ? "Sur place" : "Emporter";
      let room = rooms.find((r) => r.name.toLowerCase() === roomName.toLowerCase());
      
      if (!room) {
        const newRoomId = await addRoom(roomName);
        room = { id: newRoomId, name: roomName };
      }

      const freeTable = tables.find((t) => t.roomId === room?.id && t.status === "libre");
      let targetTableId = "";
      
      if (freeTable) {
        await updateTable(freeTable.id, {
          status: "occupee",
          occupiedSince: new Date().toISOString(),
          orderTotal: 0,
        });
        targetTableId = freeTable.id;
      } else {
        const allRoomTables = tables.filter((t) => t.roomId === room?.id);
        const maxNumber = allRoomTables.reduce((max, t) => Math.max(max, t.number), 0);
        const nextNumber = maxNumber + 1;
        
        targetTableId = await addTable({
          number: nextNumber,
          seats: 1,
          status: "occupee",
          roomId: room!.id,
        });
        
        await updateTable(targetTableId, {
          occupiedSince: new Date().toISOString(),
        });
      }

      // Navigate to the respective page and open the sidebar
      const route = type === "sur-place" ? "/tables" : "/emporter";
      navigate({ to: route, search: { open: targetTableId } });
    } catch (error) {
      console.error(error);
      toast.error("Erreur de création de la commande");
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans">
      <Sidebar activePage="accueil" />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
          <div>
            <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Accueil Caisse</h1>
            <p className="text-xs text-muted-foreground">Sélectionnez le type de commande</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4 flex items-center justify-center">
          <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            
            <button
              onClick={() => createAndNavigate("sur-place")}
              disabled={loadingType !== null}
              className="group relative flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-b-[6px] border-emerald-300 bg-emerald-100 p-8 transition-all hover:-translate-y-1 hover:shadow-xl active:translate-y-1 active:border-b-[2px] disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950/60"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-transform group-hover:scale-110">
                <Armchair className="h-10 w-10" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-black text-emerald-900 dark:text-emerald-100 uppercase">Sur Place</h2>
                <p className="text-sm font-medium text-emerald-700/80 dark:text-emerald-400">Créer un nouveau ticket</p>
              </div>
              {loadingType === "sur-place" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-black/10 backdrop-blur-sm">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
                </div>
              )}
            </button>

            <button
              onClick={() => createAndNavigate("emporter")}
              disabled={loadingType !== null}
              className="group relative flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-b-[6px] border-orange-300 bg-orange-100 p-8 transition-all hover:-translate-y-1 hover:shadow-xl active:translate-y-1 active:border-b-[2px] disabled:opacity-50 dark:border-orange-700 dark:bg-orange-950/60"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg transition-transform group-hover:scale-110">
                <ShoppingBag className="h-10 w-10" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-black text-orange-900 dark:text-orange-100 uppercase">À Emporter</h2>
                <p className="text-sm font-medium text-orange-700/80 dark:text-orange-400">Créer une commande</p>
              </div>
              {loadingType === "emporter" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-black/10 backdrop-blur-sm">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
                </div>
              )}
            </button>

          </div>
        </main>
      </div>

      <MobileBottomNav activePage="accueil" />
    </div>
  );
}
