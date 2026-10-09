import { useState } from "react";
import { Plus, Trash2, Edit2, Grid3X3, Loader2 } from "lucide-react";
import { useTableStore, type TableItem } from "@/lib/tableStore";

export function TableManager() {
  const {
    tables,
    rooms,
    loading,
    addTable,
    updateTable,
    deleteTable,
  } = useTableStore();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table Form State
  const [isEditing, setIsEditing] = useState<TableItem | null>(null);
  const [showTableForm, setShowTableForm] = useState(false);

  // Exclure uniquement les tables de la salle "emporter" de la vue admin
  const emporterRoom = rooms.find(r => r.name.toLowerCase() === "emporter");
  const adminTables = tables.filter(t => !emporterRoom || t.roomId !== emporterRoom.id);

  const handleDeleteTable = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await deleteTable(id);
    } catch (err: any) {
      setError(err.message ?? "Erreur lors de la suppression");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden bg-background">
      {/* Header + Bouton Ajouter */}
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <h2 className="text-xl font-bold">Tables</h2>
        <button
          type="button"
          onClick={() => {
            setIsEditing(null);
            setShowTableForm(true);
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Ajouter une table
        </button>
      </div>

      {error && (
        <p className="px-5 pt-3 text-xs text-destructive">{error}</p>
      )}

      {/* Tables Area */}
      <div className="flex-1 overflow-y-auto p-5">
        {showTableForm ? (
          <TableForm
            initialData={isEditing}
            onSave={async (tbl) => {
              setSaving(true);
              setError(null);
              try {
                if (isEditing) {
                  await updateTable(isEditing.id, tbl);
                } else {
                  const { id: _id, ...rest } = tbl;
                  await addTable(rest);
                }
                setShowTableForm(false);
                setIsEditing(null);
              } catch (err: any) {
                setError(err.message ?? "Erreur lors de la sauvegarde");
              } finally {
                setSaving(false);
              }
            }}
            onCancel={() => { setShowTableForm(false); setIsEditing(null); }}
            saving={saving}
          />
        ) : loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4 pb-4">
            {adminTables.map(tbl => (
              <div key={tbl.id} className="relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-border bg-background p-4 transition-colors hover:border-primary/50 aspect-square">
                <Grid3X3 className="h-8 w-8 text-muted-foreground" />
                <span className="font-bold text-lg">T{tbl.number}</span>

                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    onClick={() => { setIsEditing(tbl); setShowTableForm(true); }}
                    className="grid place-items-center rounded-md bg-muted/50 p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Modifier"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteTable(tbl.id)}
                    className="grid place-items-center rounded-md bg-destructive/10 p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {(adminTables?.length || 0) === 0 && (
              <p className="col-span-full text-sm text-muted-foreground">
                Aucune table. Cliquez sur "Ajouter une table" pour commencer.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TableForm({
  initialData,
  onSave,
  onCancel,
  saving,
}: {
  initialData: TableItem | null,
  onSave: (t: TableItem) => void,
  onCancel: () => void,
  saving: boolean,
}) {
  const [number, setNumber] = useState(initialData?.number?.toString() || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!number) return;

    onSave({
      id: initialData?.id || `t_${Date.now()}`,
      number: parseInt(number),
      status: initialData?.status || "libre",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg bg-background p-4 border border-border max-w-md">
      <h3 className="text-lg font-semibold">{initialData ? "Modifier" : "Nouvelle"} Table</h3>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Numéro / Nom de la table</label>
        <input
          autoFocus
          required
          type="number"
          min="1"
          placeholder="Ex: 1, 2, 3…"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
          Annuler
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Enregistrer
        </button>
      </div>
    </form>
  );
}
