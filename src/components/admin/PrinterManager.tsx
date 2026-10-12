import { useEffect, useState } from "react";
import {
  Printer as PrinterIcon,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Bluetooth,
  BluetoothConnected,
  Tablet,
  RefreshCw,
  Flame,
  CreditCard,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { usePrinterStore, type Printer, type PrinterType } from "@/lib/printerStore";
import { printerService } from "@/lib/printerService";
import { usePrintSettingsStore } from "@/lib/printSettingsStore";
import { useEffectiveHubKeepActive } from "@/lib/hubKeepActiveStore";
import {
  fetchRecentPrintJobs,
  requeueFailedKitchenJob,
  type PrintJob,
} from "@/lib/kitchenPrintQueue";
import { closeCircuit } from "@/lib/kitchenCircuitBreaker";
import {
  getPrintActivity,
  subscribePrintActivity,
  type PrintActivityEntry,
} from "@/lib/printActivityLog";
import {
  getPrinterReachability,
  isProbingAllPrinters,
  probeAllPrinters,
  probeOnePrinter,
  subscribePrinterReachability,
  type PrinterReachability,
} from "@/lib/printerProbe";
import { ComponentLoader } from "@/components/ui/PageLoader";
import { Switch } from "@/components/ui/switch";
import { useMenuStore, type CategoryItem } from "@/lib/menuStore";

export function PrinterManager() {
  const { printers, loading, addPrinter, updatePrinter, deletePrinter } =
    usePrinterStore();
  const { categories } = useMenuStore();
  const {
    localDeviceId,
    primaryDeviceId,
    isPrimaryHub,
    loading: hubLoading,
    claimPrimaryHub,
  } = usePrintSettingsStore();
  const { effective: hubKeepActive, setKeepActive } =
    useEffectiveHubKeepActive(isPrimaryHub);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Printer>>({});
  const [pairedDevices, setPairedDevices] = useState<
    { name: string; address: string }[]
  >([]);
  const [scanning, setScanning] = useState(false);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);
  const [activity, setActivity] = useState<PrintActivityEntry[]>(() =>
    getPrintActivity(),
  );
  const [reachability, setReachability] = useState<
    Record<string, PrinterReachability>
  >(() => getPrinterReachability());
  const [probingAll, setProbingAll] = useState(() => isProbingAllPrinters());

  const caissePrinter = printers.find((p) => p.type === "caisse") ?? null;
  const fourPrinter = printers.find((p) => p.type === "four") ?? null;

  // Can add a printer of a given type if none exists yet
  const canAddCaisse = !caissePrinter && editingId !== "new-caisse";
  const canAddFour = !fourPrinter && editingId !== "new-four";

  useEffect(() => {
    return subscribePrintActivity(() => setActivity(getPrintActivity()));
  }, []);

  useEffect(() => {
    return subscribePrinterReachability(() => {
      setReachability(getPrinterReachability());
      setProbingAll(isProbingAllPrinters());
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchRecentPrintJobs(8).then((jobs) => {
      if (mounted) setRecentJobs(jobs);
    });
    const t = setInterval(() => {
      void fetchRecentPrintJobs(8).then((jobs) => {
        if (mounted) setRecentJobs(jobs);
      });
    }, 8000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  const probePrinter = async (printer: Printer) => probeOnePrinter(printer);

  const probeAll = async () => {
    await probeAllPrinters({ enabledOnly: false, skipIfBusyQueue: false });
  };

  useEffect(() => {
    if (loading || hubLoading || printers.length === 0) return;
    setReachability((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of printers) {
        if (!next[p.id]) {
          next[p.id] = {
            status: "unknown",
            detail: isPrimaryHub
              ? "Vérification Bluetooth automatique…"
              : "Définissez cet appareil comme hub pour vérifier",
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [loading, hubLoading, printers, isPrimaryHub]);

  if (loading || hubLoading) return <ComponentLoader />;

  const handleEdit = (printer: Printer) => {
    setEditingId(printer.id);
    setFormData({ ...printer });
  };

  const handleSave = async (id: string) => {
    try {
      const willEnable = formData.enabled ?? true;
      const printerType: PrinterType = (formData.type as PrinterType) ?? "caisse";

      if (id === "new-caisse" || id === "new-four") {
        await addPrinter({
          name: formData.name || "",
          type: printerType,
          mac_address: formData.mac_address ?? null,
          enabled: willEnable,
          categories: formData.categories ?? [],
          category_ids: formData.category_ids ?? [],
        });
      } else {
        await updatePrinter(id, {
          ...formData,
          type: printerType,
        });
      }
      setEditingId(null);
      setFormData({});
      toast.success("Imprimante enregistrée");
    } catch (err: any) {
      toast.error("Erreur lors de l'enregistrement", {
        description: err.message,
      });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormData({});
    setPairedDevices([]);
  };

  const scanDevices = async () => {
    setScanning(true);
    try {
      const devices = await printerService.getPairedDevices();
      setPairedDevices(devices);
      if (devices.length === 0) {
        toast.info(
          "Aucun appareil Bluetooth associé trouvé sur la tablette.",
        );
      }
    } catch (err: any) {
      toast.error("Erreur de scan Bluetooth", { description: err.message });
    }
    setScanning(false);
  };

  const handleTestPrint = async (printer: Printer) => {
    try {
      toast.info("Connexion / test Bluetooth…");
      const reach = await probePrinter(printer);
      if (!reach.ok) {
        toast.error("Imprimante injoignable", { description: reach.detail });
        return;
      }
      await printerService.printTest(printer);
      toast.success("Test d'impression envoyé !");
      await probePrinter(printer);
    } catch (err: any) {
      toast.error("Échec de l'impression", { description: err.message });
      await probePrinter(printer);
    }
  };

  const isEditing = (id: string) => editingId === id;

  // Toggle a category in the form's category_ids
  const toggleCategory = (cat: CategoryItem) => {
    const current = formData.category_ids ?? [];
    const currentNames = formData.categories ?? [];
    const idx = current.indexOf(cat.id);
    if (idx >= 0) {
      setFormData({
        ...formData,
        category_ids: current.filter((id) => id !== cat.id),
        categories: currentNames.filter((n) => n !== cat.name),
      });
    } else {
      setFormData({
        ...formData,
        category_ids: [...current, cat.id],
        categories: [...currentNames, cat.name],
      });
    }
  };

  const renderForm = (type: PrinterType, existingPrinter?: Printer) => {
    const isNew = !existingPrinter;
    const saveId = isNew ? `new-${type}` : existingPrinter!.id;
    const isFour = type === "four";

    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm mb-4">
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${isFour ? "bg-orange-500/10 text-orange-600" : "bg-primary/10 text-primary"}`}>
            {isFour ? <Flame className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
            {isFour ? "Imprimante Four (Cuisine)" : "Imprimante Caisse (Reçus)"}
          </div>
        </div>

        {/* Nom */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Nom de l&apos;imprimante
          </label>
          <input
            type="text"
            value={formData.name || ""}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value, type })
            }
            placeholder={isFour ? "Ex: Four Cuisine" : "Ex: Imprimante Caisse"}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* MAC Address (native only) */}
        {printerService.isNativePlatform() && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Appareil Bluetooth (Adresse MAC)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.mac_address || ""}
                onChange={(e) =>
                  setFormData({ ...formData, mac_address: e.target.value })
                }
                placeholder="Sélectionnez un appareil ci-contre ->"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={scanDevices}
                disabled={scanning}
                className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
              >
                {scanning ? "Recherche..." : "Rechercher"}
              </button>
            </div>
            {pairedDevices.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-2 max-h-40 overflow-y-auto">
                <p className="text-xs text-muted-foreground mb-1 font-semibold">
                  Appareils appairés (cliquez pour sélectionner) :
                </p>
                {pairedDevices.map((d) => (
                  <button
                    key={d.address}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, mac_address: d.address })
                    }
                    className={`flex items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors ${
                      formData.mac_address === d.address
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted bg-background border border-transparent hover:border-border"
                    }`}
                  >
                    <span>{d.name || "Appareil Inconnu"}</span>
                    <span
                      className={`text-xs ${
                        formData.mac_address === d.address
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground"
                      }`}
                    >
                      {d.address}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              Vous devez d&apos;abord associer (appairer) l&apos;imprimante dans
              les réglages Bluetooth d&apos;Android.
            </p>
          </div>
        )}

        {/* Catégories (four only) */}
        {isFour && (
          <div>
            <label className="mb-2 block text-xs font-semibold text-muted-foreground">
              <Tag className="inline h-3.5 w-3.5 mr-1" />
              Catégories à imprimer
              <span className="ml-1 text-muted-foreground font-normal">(laissez vide = tout imprimer)</span>
            </label>
            {categories.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Aucune catégorie disponible dans le menu.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const selected = (formData.category_ids ?? []).includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                        selected
                          ? "border-orange-500 bg-orange-500/10 text-orange-600 shadow-sm"
                          : "border-border bg-background text-foreground hover:border-orange-400 hover:bg-orange-500/5"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            )}
            {(formData.category_ids ?? []).length > 0 && (
              <p className="mt-2 text-[11px] text-orange-600 font-medium">
                ✓ Seuls les articles des catégories sélectionnées seront imprimés au four.
              </p>
            )}
            {(formData.category_ids ?? []).length === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Aucune catégorie sélectionnée → tous les articles seront imprimés.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" /> Annuler
          </button>
          <button
            type="button"
            onClick={() => handleSave(saveId)}
            disabled={!formData.name}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
              isFour ? "bg-orange-600 hover:bg-orange-700" : "bg-primary hover:bg-primary/90 text-primary-foreground"
            }`}
          >
            <Check className="h-4 w-4" /> Enregistrer
          </button>
        </div>
      </div>
    );
  };

  const renderPrinterCard = (printer: Printer) => {
    if (isEditing(printer.id)) {
      return (
        <div key={printer.id} className="col-span-full">
          {renderForm(printer.type, printer)}
        </div>
      );
    }

    const reach = reachability[printer.id] ?? {
      status: "unknown" as const,
      detail: "Non vérifié",
    };
    const isOk = reach.status === "ok";
    const isChecking = reach.status === "checking";
    const isBusy = reach.status === "busy";
    const isFour = printer.type === "four";

    return (
      <div
        key={printer.id}
        className={`flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-all ${
          !printer.enabled
            ? "opacity-60 grayscale-[0.5]"
            : "border-border hover:shadow-md"
        }`}
      >
        {/* Card Header */}
        <div className={`flex items-start justify-between border-b border-border p-4 ${isFour ? "bg-orange-500/5" : "bg-muted/20"}`}>
          <div className="flex items-center gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${isFour ? "bg-orange-500/10" : "bg-primary/10"}`}>
              {isFour
                ? <Flame className="h-5 w-5 text-orange-600" />
                : <PrinterIcon className="h-5 w-5 text-primary" />
              }
            </div>
            <div>
              <h3 className="font-bold text-foreground">{printer.name}</h3>
              <p className={`text-xs font-semibold ${isFour ? "text-orange-600" : "text-primary"}`}>
                {isFour ? "Four — Cuisine" : "Caisse — Reçus"}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                {printer.mac_address || "MAC manquante"}
              </p>
            </div>
          </div>
          {/* Reachability indicator */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                {!isChecking && !isBusy && (
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isOk ? "bg-success animate-ping" : "bg-destructive"
                    }`}
                  />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isChecking || isBusy
                      ? "bg-amber-500"
                      : isOk
                        ? "bg-success"
                        : reach.status === "unknown"
                          ? "bg-muted-foreground"
                          : "bg-destructive"
                  }`}
                />
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">
                {isChecking
                  ? "Vérif…"
                  : isOk
                    ? "Joignable"
                    : isBusy
                      ? "Occupée"
                      : reach.status === "unknown"
                        ? "Inconnu"
                        : "Injoignable"}
              </span>
            </div>
            <span
              className="text-[9px] text-muted-foreground max-w-[140px] text-right truncate"
              title={reach.detail}
            >
              {reach.detail}
            </span>
          </div>
        </div>

        {/* Card Body */}
        <div className="flex-1 p-4">
          {isFour ? (
            printer.category_ids && printer.category_ids.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" /> Catégories imprimées :
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {printer.categories.map((catName, i) => (
                    <span key={i} className="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-600">
                      {catName}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Imprime <span className="font-semibold">tous les articles</span> (aucune catégorie restreinte).
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              Imprime les tickets d&apos;encaissement uniquement.
            </p>
          )}
        </div>

        {/* Card Actions */}
        <div className="flex flex-wrap items-center justify-between border-t border-border bg-card p-3 gap-2">
          <button
            type="button"
            onClick={() => handleTestPrint(printer)}
            disabled={!printer.enabled}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            {isOk ? (
              <BluetoothConnected className="h-3.5 w-3.5 text-blue-500" />
            ) : (
              <Bluetooth className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            Tester
          </button>
          <button
            type="button"
            onClick={() => handleEdit(printer)}
            className="flex items-center justify-center rounded-lg bg-secondary p-2 text-secondary-foreground hover:bg-secondary/80"
            title="Modifier"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={async () => {
              await updatePrinter(printer.id, {
                enabled: !printer.enabled,
              });
              toast.success(
                `Imprimante ${!printer.enabled ? "activée" : "désactivée"}`,
              );
            }}
            className={`flex items-center justify-center rounded-lg border p-2 ${
              printer.enabled
                ? "border-border text-muted-foreground hover:bg-muted"
                : "border-success bg-success/10 text-success hover:bg-success/20"
            }`}
            title={printer.enabled ? "Désactiver" : "Activer"}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={async () => {
              if (confirm("Supprimer cette imprimante ?")) {
                await deletePrinter(printer.id);
              }
            }}
            className="flex items-center justify-center rounded-lg border border-border p-2 text-destructive hover:bg-destructive/10"
            title="Supprimer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">

      {/* ── Hub card ── */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10">
              <Tablet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">
                Hub d&apos;impression caisse
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Un seul appareil (tablette caisse) imprime les reçus via
                Bluetooth. Les autres sessions envoient uniquement des jobs en
                file d&apos;attente.
              </p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all">
                Cet appareil : {localDeviceId}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground break-all">
                Hub actuel : {primaryDeviceId || "(non défini)"}
              </p>
              <p className="mt-1 text-xs font-semibold">
                {isPrimaryHub ? (
                  <span className="text-success">
                    Cet appareil est le hub primaire
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    Cet appareil n&apos;est pas le hub — l&apos;impression
                    Bluetooth ne partira pas d&apos;ici
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await claimPrimaryHub();
                toast.success("Cet appareil est maintenant le hub d'impression");
              } catch (err: any) {
                toast.error("Impossible de définir le hub", {
                  description: err.message,
                });
              }
            }}
            className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
          >
            Définir cet appareil comme hub
          </button>
        </div>

        <div className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Maintenir le hub actif sur cet appareil
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Le hub continue d&apos;imprimer sans connexion employé. Sur
              Android, une notification « Impression caisse — hub actif »
              reste visible.
            </p>
            {!isPrimaryHub && (
              <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Définir cet appareil comme hub d&apos;abord
              </p>
            )}
          </div>
          <Switch
            checked={hubKeepActive}
            disabled={!isPrimaryHub}
            onCheckedChange={(on) => {
              setKeepActive(on);
              if (on) {
                toast.message("Hub maintenu actif", {
                  description:
                    "Sur Android, désactivez l'optimisation batterie pour cette app si les impressions s'arrêtent en arrière-plan.",
                });
              } else {
                toast.message("Hub actif désactivé", {
                  description:
                    "L'impression nécessite une connexion employé sur cet appareil.",
                });
              }
            }}
            aria-label="Maintenir le hub actif sur cet appareil"
          />
        </div>

        {activity.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Activité impression (caisse + tests) — locale
            </p>
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {activity.slice(0, 12).map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 text-xs text-foreground"
                >
                  <span className="text-muted-foreground">
                    {new Date(a.at).toLocaleTimeString("fr-FR")}
                  </span>
                  <span className="uppercase font-semibold">{a.kind}</span>
                  <span>{a.printerName}</span>
                  <span
                    className={
                      a.status === "success"
                        ? "text-success"
                        : a.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {a.status}
                  </span>
                  {a.detail && (
                    <span
                      className="w-full text-muted-foreground truncate"
                      title={a.detail}
                    >
                      {a.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recentJobs.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Derniers tickets caisse
            </p>
            <ul className="space-y-1">
              {recentJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground"
                >
                  <span className="font-mono text-muted-foreground">
                    {j.id.slice(0, 8)}
                  </span>
                  <span className="capitalize">{j.status}</span>
                  <span className="text-muted-foreground">
                    {new Date(j.created_at).toLocaleString("fr-FR")}
                  </span>
                  {j.status === "needs_manual" && (
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold hover:bg-muted"
                      onClick={async () => {
                        try {
                          if (caissePrinter) {
                            closeCircuit(caissePrinter.mac_address);
                          }
                          await requeueFailedKitchenJob(j.id);
                          toast.success("Job remis en file");
                          const jobs = await fetchRecentPrintJobs(8);
                          setRecentJobs(jobs);
                        } catch (err: any) {
                          toast.error("Relance impossible", {
                            description: err.message,
                          });
                        }
                      }}
                    >
                      Relancer
                    </button>
                  )}
                  {j.error && (
                    <span
                      className="w-full text-destructive truncate"
                      title={j.error}
                    >
                      {j.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Section Caisse ── */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Imprimante Caisse</h2>
            <p className="text-xs text-muted-foreground">Reçus d&apos;encaissement (1 seule)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void probeAll()}
            disabled={probingAll || printers.length === 0}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${probingAll ? "animate-spin" : ""}`} />
            Vérifier Bluetooth
          </button>
          {canAddCaisse && (
            <button
              type="button"
              onClick={() => {
                setEditingId("new-caisse");
                setFormData({ name: "", type: "caisse", categories: [], category_ids: [], enabled: true });
              }}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm"
            >
              <Plus className="h-4 w-4" /> Ajouter
            </button>
          )}
        </div>
      </div>

      {isEditing("new-caisse") && renderForm("caisse")}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {printers.filter((p) => p.type === "caisse").map(renderPrinterCard)}
        {!caissePrinter && !isEditing("new-caisse") && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-muted mb-3">
              <PrinterIcon className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold text-foreground">Aucune imprimante caisse</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">Cliquez &quot;Ajouter&quot; pour configurer l&apos;imprimante Bluetooth de caisse.</p>
          </div>
        )}
      </div>

      {/* ── Section Four ── */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-orange-500/10">
            <Flame className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Imprimante Four</h2>
            <p className="text-xs text-muted-foreground">Tickets cuisine avec catégories filtrées (1 seule)</p>
          </div>
        </div>
        {canAddFour && (
          <button
            type="button"
            onClick={() => {
              setEditingId("new-four");
              setFormData({ name: "", type: "four", categories: [], category_ids: [], enabled: true });
            }}
            className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-700"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {isEditing("new-four") && renderForm("four")}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {printers.filter((p) => p.type === "four").map(renderPrinterCard)}
        {!fourPrinter && !isEditing("new-four") && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-orange-300/50 py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-orange-500/10 mb-3">
              <Flame className="h-6 w-6 text-orange-400/50" />
            </div>
            <p className="text-sm font-semibold text-foreground">Aucune imprimante four</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Ajoutez une imprimante four pour imprimer les tickets cuisine avec l&apos;entête <strong>À TABLE</strong> / <strong>À EMPORTER</strong>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
