import { useState, useRef } from "react";
import { useIsMobile, usePrefersCoarsePointer } from "@/hooks/use-mobile";
import { Plus, Trash2, Edit2, ImageIcon, Layers, ShoppingBag, ArrowLeft, Tag, Folder, Box, Coffee, Utensils, ChefHat, Loader2, GripVertical } from "lucide-react";
import { ImageUploader } from "./ImageUploader";
import { type Product } from "@/data/menu";
import { useMenuStore, type CategoryItem } from "@/lib/menuStore";

type MenuView = "home" | "categories" | "products";

// ── useDragReorder ─────────────────────────────────────────────────
// Generic hook that manages HTML5 drag-and-drop list reordering.
// Returns drag event props for each item and the reordered list on drop.

function useDragReorder<T extends { id: string }>(
  items: T[],
  onReorder: (newOrder: T[]) => void,
) {
  const draggedId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getProps = (id: string) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      draggedId.current = id;
      setIsDragging(true);
      e.dataTransfer.effectAllowed = "move";
      // Slight delay so the browser snapshot shows the card before it fades
      setTimeout(() => {
        setDragOverId(id);
      }, 0);
    },
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedId.current !== id) setDragOverId(id);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragLeave: () => {
      // Keep dragOverId so the highlight doesn't flicker when moving over children
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const fromId = draggedId.current;
      const toId = id;
      if (!fromId || fromId === toId) {
        draggedId.current = null;
        setDragOverId(null);
        setIsDragging(false);
        return;
      }

      const fromIdx = items.findIndex((x) => x.id === fromId);
      const toIdx = items.findIndex((x) => x.id === toId);
      if (fromIdx === -1 || toIdx === -1) return;

      const next = [...items];
      const [moved] = next.splice(fromIdx, 1) as [T];
      next.splice(toIdx, 0, moved);

      draggedId.current = null;
      setDragOverId(null);
      setIsDragging(false);
      onReorder(next);
    },
    onDragEnd: () => {
      draggedId.current = null;
      setDragOverId(null);
      setIsDragging(false);
    },
  });

  return { getProps, dragOverId, isDragging, draggedId };
}

export function MenuManager() {
  const isMobile = useIsMobile();
  const coarse = usePrefersCoarsePointer();
  const isTouchUi = isMobile || coarse;
  const [view, setView] = useState<MenuView>("home");
  const {
    products: _products,
    categories: _categories,
    loading,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    addProduct,
    updateProduct,
    deleteProduct,
    reorderProducts,
  } = useMenuStore();
  // Guard against undefined during initial render on mobile (Capacitor WebView)
  const products = _products ?? [];
  const categories = _categories ?? [];

  const [activeCategory, setActiveCategory] = useState<string>("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatImage, setNewCatImage] = useState("");
  const [isEditingCat, setIsEditingCat] = useState<CategoryItem | null>(null);
  const [isEditing, setIsEditing] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync activeCategory when categories load
  const effectiveCategory = activeCategory || categories[0]?.name || "";

  // ── Drag & drop for categories ──────────────────────────────────
  const catDrag = useDragReorder(categories, async (newOrder) => {
    setReordering(true);
    setError(null);
    try {
      await reorderCategories(newOrder.map((c) => c.id));
    } catch (err: any) {
      setError(err.message ?? "Erreur lors du réordonnancement");
    } finally {
      setReordering(false);
    }
  });

  // ── Drag & drop for products (filtered by active category) ──────
  const filteredProducts = products.filter((p) => p.category === effectiveCategory);
  const prodDrag = useDragReorder(filteredProducts, async (newOrder) => {
    setReordering(true);
    setError(null);
    try {
      await reorderProducts(newOrder.map((p) => p.id));
    } catch (err: any) {
      setError(err.message ?? "Erreur lors du réordonnancement");
    } finally {
      setReordering(false);
    }
  });

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (isEditingCat && isEditingCat.id) {
        await updateCategory(isEditingCat.id, {
          name: newCatName.trim(),
          image: newCatImage,
        });
        if (activeCategory === isEditingCat.name) {
          setActiveCategory(newCatName.trim());
        }
        setIsEditingCat(null);
      } else {
        await addCategory({ name: newCatName.trim(), image: newCatImage });
      }
      setNewCatName("");
      setNewCatImage("");
    } catch (err: any) {
      setError(err.message ?? "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const handleEditCategoryClick = (cat: CategoryItem) => {
    setIsEditingCat(cat);
    setNewCatName(cat.name);
    setNewCatImage(cat.image || "");
  };

  const handleCancelEditCat = () => {
    setIsEditingCat(null);
    setNewCatName("");
    setNewCatImage("");
  };

  const handleDeleteCategory = async (cat: CategoryItem) => {
    if (!cat.id) return;
    setSaving(true);
    setError(null);
    try {
      await deleteCategory(cat.id);
      if (activeCategory === cat.name) setActiveCategory(categories[0]?.name || "");
    } catch (err: any) {
      setError(err.message ?? "Erreur lors de la suppression");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      await deleteProduct(id);
    } catch (err: any) {
      setError(err.message ?? "Erreur lors de la suppression");
    } finally {
      setSaving(false);
    }
  };

  // ── HOME: two big 3D buttons ───────────────────────────────────
  if (view === "home") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-10 overflow-y-auto overscroll-contain touch-pan-y p-8">
        <h2 className="text-2xl font-bold text-foreground">Gestion du Menu</h2>
        <div className="flex flex-col sm:flex-row gap-8">

          {/* Gestion Catégorie */}
          <button
            onClick={() => setView("categories")}
            className="group relative flex flex-col items-center gap-4 rounded-2xl px-10 py-10 text-white transition-all duration-150 active:translate-y-1 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #6366f1, #4f46e5)",
              boxShadow: "0 8px 0 #3730a3, 0 12px 20px rgba(99,102,241,0.4)",
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 0 #3730a3, 0 6px 10px rgba(99,102,241,0.4)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(4px)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 0 #3730a3, 0 12px 20px rgba(99,102,241,0.4)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <Tag className="absolute top-4 left-4 h-8 w-8 -rotate-12" />
              <Folder className="absolute bottom-6 right-6 h-10 w-10 rotate-12" />
              <Box className="absolute top-1/2 right-4 h-6 w-6 rotate-45" />
              <Layers className="absolute bottom-4 left-8 h-8 w-8 -rotate-6" />
            </div>
            <div className="grid h-16 w-16 place-items-center rounded-full bg-white/20 backdrop-blur-sm relative z-10">
              <Layers className="h-8 w-8 text-white" />
            </div>
            <span className="text-xl font-bold tracking-wide relative z-10">Gestion Catégorie</span>
            <span className="text-sm text-white/70 relative z-10">
              {loading ? "…" : `${categories?.length || 0} catégories`}
            </span>
          </button>

          {/* Gestion Produit */}
          <button
            onClick={() => setView("products")}
            className="group relative flex flex-col items-center gap-4 rounded-2xl px-10 py-10 text-white transition-all duration-150 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              boxShadow: "0 8px 0 #92400e, 0 12px 20px rgba(245,158,11,0.4)",
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 0 #92400e, 0 6px 10px rgba(245,158,11,0.4)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(4px)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 0 #92400e, 0 12px 20px rgba(245,158,11,0.4)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <Coffee className="absolute top-4 right-4 h-8 w-8 rotate-12" />
              <Utensils className="absolute bottom-6 left-6 h-10 w-10 -rotate-12" />
              <ShoppingBag className="absolute top-1/2 left-4 h-6 w-6 -rotate-45" />
              <ChefHat className="absolute bottom-4 right-8 h-8 w-8 rotate-6" />
            </div>
            <div className="grid h-16 w-16 place-items-center rounded-full bg-white/20 backdrop-blur-sm relative z-10">
              <ShoppingBag className="h-8 w-8 text-white" />
            </div>
            <span className="text-xl font-bold tracking-wide relative z-10">Gestion Produit</span>
            <span className="text-sm text-white/70 relative z-10">
              {loading ? "…" : `${products?.length || 0} produits`}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ── CATEGORIES VIEW ────────────────────────────────────────────
  if (view === "categories") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain touch-pan-y p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Retour
          </button>
          <h2 className="text-xl font-bold">Gestion des Catégories</h2>
          {reordering && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Enregistrement…
            </span>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
        )}

        <form onSubmit={handleAddCategory} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 max-w-sm">
          <h3 className="text-sm font-semibold">{isEditingCat ? "Modifier la catégorie" : "Ajouter une catégorie"}</h3>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Nom de la catégorie</label>
            <input
              type="text"
              placeholder="Nom de la catégorie..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Image de la catégorie</label>
            <ImageUploader value={newCatImage} onChange={setNewCatImage} />
          </div>
          <div className="flex gap-2 mt-1">
            {isEditingCat && (
              <button type="button" onClick={handleCancelEditCat} className="flex-1 rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
                Annuler
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditingCat ? "Enregistrer" : <><Plus className="h-4 w-4" /> Ajouter</>}
            </button>
          </div>
        </form>

        {/* Drag hint */}
        {!isTouchUi && !loading && (categories?.length || 0) > 1 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground -mt-3">
            <GripVertical className="h-3.5 w-3.5" />
            Glissez les cartes pour réorganiser l'ordre des catégories
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {categories.map(cat => {
              const dragProps = isTouchUi ? {} : catDrag.getProps(cat.id);
              const isOver = !isTouchUi && catDrag.dragOverId === cat.id && catDrag.draggedId.current !== cat.id;
              const isDragged = !isTouchUi && catDrag.draggedId.current === cat.id;

              return (
                <div
                  key={cat.id ?? cat.name}
                  {...dragProps}
                  className={[
                    "group relative flex flex-col gap-2 rounded-xl border bg-card p-2 transition-all duration-150",
                    isTouchUi ? "touch-pan-y" : "cursor-grab active:cursor-grabbing select-none",
                    isOver
                      ? "border-primary shadow-lg shadow-primary/20 scale-[1.02]"
                      : "border-border",
                    isDragged ? "opacity-40 scale-95" : "opacity-100",
                  ].join(" ")}
                >
                  {/* Drag handle badge */}
                  <div className="absolute top-2 left-2 z-10 flex items-center justify-center rounded bg-background/80 p-1 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm pointer-events-none">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>

                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
                    {cat.image ? (
                      <img src={cat.image} alt={cat.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-6 w-6 opacity-20" />
                      </div>
                    )}
                    <div className="absolute right-2 top-2 flex gap-1">
                      <button
                        onClick={() => handleEditCategoryClick(cat)}
                        className="grid place-items-center rounded bg-background/90 p-1.5 text-foreground backdrop-blur-sm hover:bg-background"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(cat)}
                        className="grid place-items-center rounded bg-destructive/90 p-1.5 text-destructive-foreground backdrop-blur-sm hover:bg-destructive"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="px-1 pb-1">
                    <span className="font-semibold text-sm">{cat.name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── PRODUCTS VIEW ──────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col gap-0 overflow-hidden bg-background">
      {/* Category selector (Horizontal Row with Circles) */}
      <div className="w-full shrink-0 border-b border-border bg-card">
        <div className="flex min-w-0 touch-pan-x items-center gap-4 overflow-x-auto overscroll-x-contain p-4 no-scrollbar">
          <button 
            onClick={() => setView("home")} 
            className="flex shrink-0 h-16 w-16 flex-col items-center justify-center gap-1 rounded-full border-2 border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-[10px] font-medium">Retour</span>
          </button>
          
          <div className="h-10 w-px bg-border shrink-0 mx-1" />

          {loading ? (
            <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : (categories?.length || 0) === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">Aucune catégorie. Créez-en une depuis "Gestion Catégorie".</p>
          ) : (
            categories.map(cat => (
              <button
                key={cat.id ?? cat.name}
                onClick={() => setActiveCategory(cat.name)}
                className={`group flex shrink-0 flex-col items-center gap-2 transition-all ${effectiveCategory === cat.name ? "opacity-100 scale-105" : "opacity-70 hover:opacity-100"}`}
              >
                <div className={`relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 transition-colors ${effectiveCategory === cat.name ? "border-primary shadow-md" : "border-border bg-muted group-hover:border-primary/50"}`}>
                  {cat.image ? (
                    <img src={cat.image} alt={cat.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold uppercase">{cat.name.substring(0, 2)}</span>
                  )}
                </div>
                <span className={`text-xs font-medium ${effectiveCategory === cat.name ? "text-primary font-bold" : "text-muted-foreground"}`}>
                  {cat.name}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Products grid */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold">{effectiveCategory || "—"}</h3>
            {reordering && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Enregistrement…
              </span>
            )}
          </div>
          <button
            onClick={() => { setIsEditing(null); setShowProductForm(true); }}
            disabled={!effectiveCategory}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Ajouter Produit
          </button>
        </div>

        {error && (
          <p className="mx-4 mt-3 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y p-4">
          {showProductForm ? (
            <ProductForm
              initialData={isEditing}
              category={effectiveCategory}
              categories={categories.map(c => c.name)}
              fullCategories={categories}
              onSave={async (prod) => {
                setSaving(true);
                setError(null);
                try {
                  if (isEditing) {
                    await updateProduct(isEditing.id, prod);
                  } else {
                    const { id: _id, ...rest } = prod;
                    await addProduct(rest);
                  }
                  setShowProductForm(false);
                  setIsEditing(null);
                } catch (err: any) {
                  setError(err.message ?? "Erreur lors de la sauvegarde");
                } finally {
                  setSaving(false);
                }
              }}
              onCancel={() => { setShowProductForm(false); setIsEditing(null); }}
              saving={saving}
            />
          ) : loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : (
            <>
              {/* Drag hint */}
              {!isTouchUi && (filteredProducts?.length || 0) > 1 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                  <GripVertical className="h-3.5 w-3.5" />
                  Glissez les cartes pour réorganiser l'ordre des produits
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map(prod => {
                  const dragProps = isTouchUi ? {} : prodDrag.getProps(prod.id);
                  const isOver = !isTouchUi && prodDrag.dragOverId === prod.id && prodDrag.draggedId.current !== prod.id;
                  const isDragged = !isTouchUi && prodDrag.draggedId.current === prod.id;

                  return (
                    <div
                      key={prod.id}
                      {...dragProps}
                      className={[
                        "group flex flex-col gap-3 rounded-xl border p-3 bg-card transition-all duration-150",
                        isTouchUi ? "touch-pan-y" : "cursor-grab active:cursor-grabbing select-none",
                        isOver
                          ? "border-primary shadow-lg shadow-primary/20 scale-[1.02]"
                          : "border-border",
                        isDragged ? "opacity-40 scale-95" : "opacity-100",
                      ].join(" ")}
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                        {prod.image ? (
                          <img src={prod.image} alt={prod.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-8 w-8 opacity-20" />
                          </div>
                        )}

                        {/* Drag handle */}
                        <div className="absolute top-2 left-2 flex items-center justify-center rounded bg-background/80 p-1 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm pointer-events-none">
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>

                        <div className="absolute right-2 top-2 flex gap-1">
                          <button
                            onClick={() => { setIsEditing(prod); setShowProductForm(true); }}
                            className="grid place-items-center rounded bg-background/90 p-1.5 backdrop-blur-sm hover:bg-background"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(prod.id)}
                            className="grid place-items-center rounded bg-destructive/90 p-1.5 text-destructive-foreground backdrop-blur-sm hover:bg-destructive"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <h3 className="font-semibold">{prod.name}</h3>
                        <p className="text-sm font-bold text-primary">{prod.price} DA</p>
                        <span className={`text-xs font-medium ${prod.available ? "text-green-600" : "text-destructive"}`}>
                          {prod.available ? "Disponible" : "Indisponible"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {(filteredProducts?.length || 0) === 0 && effectiveCategory && (
                  <p className="col-span-full text-sm text-muted-foreground">
                    Aucun produit dans cette catégorie.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductForm({
  initialData,
  category,
  categories,
  fullCategories,
  onSave,
  onCancel,
  saving,
}: {
  initialData: Product | null;
  category: string;
  categories: string[];
  fullCategories: CategoryItem[];
  onSave: (p: Product) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const initialCategoryName = initialData?.category || category;
  const initialCat = fullCategories.find(c => c.name === initialCategoryName);

  const [name, setName] = useState(initialData?.name || "");
  const [price, setPrice] = useState(initialData?.price?.toString() || "");
  const [image, setImage] = useState(() => {
    if (initialData?.image) return initialData.image;
    return initialCat?.image || "";
  });
  const [hasCustomImage, setHasCustomImage] = useState(() => {
    if (!initialData?.image) return false;
    return initialData.image !== initialCat?.image;
  });
  const [selectedCategory, setSelectedCategory] = useState(initialCategoryName);
  const [available, setAvailable] = useState(initialData?.available ?? true);
  const [ingredients, setIngredients] = useState(initialData?.ingredients || "");
  const [options, setOptions] = useState<{ label: string; price: string }[]>(
    initialData?.options?.map(o => ({ label: o.label, price: o.price.toString() })) ?? []
  );

  const addOption = () => setOptions(prev => {
    // Si c'est la toute première variante ajoutée, initialiser son prix avec le prix de base actuel
    const newEntry = prev.length === 0 && price
      ? { label: "", price }
      : { label: "", price: "" };
    return [...prev, newEntry];
  });

  const removeOption = (i: number) =>
    setOptions(prev => prev.filter((_, idx) => idx !== i));

  const updateOption = (i: number, field: "label" | "price", value: string) => {
    setOptions(prev => {
      const updated = prev.map((o, idx) => idx === i ? { ...o, [field]: value } : o);
      // Si c'est la 1ère variante et qu'on modifie son prix → synchroniser le prix de base
      if (i === 0 && field === "price") {
        setPrice(value);
      }
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !price) return;
    const parsedOptions = options
      .filter(o => o.label.trim())
      .map(o => ({ label: o.label.trim(), price: parseInt(o.price) || 0 }));

    // CAS 1 : Produit avec variantes → le prix de base = prix de la 1ère variante
    // CAS 2 : Produit sans variante → le prix de base est tel que saisi
    const finalPrice = parsedOptions.length > 0
      ? (parsedOptions[0]?.price ?? parseInt(price))
      : parseInt(price);

    onSave({
      id: initialData?.id || `p_${Date.now()}`,
      name: name.trim(),
      category: selectedCategory as any,
      price: finalPrice,
      image,
      available,
      options: parsedOptions.length > 0 ? parsedOptions : undefined,
      ingredients: ingredients.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 max-w-md">
      <h3 className="text-lg font-semibold">{initialData ? "Modifier" : "Nouveau"} Produit</h3>

      {/* Nom */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Nom du produit</label>
        <input autoFocus required type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
      </div>

      {/* Catégorie */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Catégorie</label>
        <select value={selectedCategory} onChange={(e) => {
          const newCatName = e.target.value;
          setSelectedCategory(newCatName);
          if (!hasCustomImage) {
            const newCat = fullCategories.find(c => c.name === newCatName);
            setImage(newCat?.image || "");
          }
        }}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary">
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Prix de base */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          Prix de base (DA)
          {options.length > 0 && (
            <span className="ml-2 text-xs font-normal text-primary/70 font-semibold">← égal au prix de la 1ère variante</span>
          )}
        </label>
        <input
          required
          type="number"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          readOnly={options.length > 0}
          title={options.length > 0 ? "Modifiez le prix de la première variante pour changer ce prix" : undefined}
          className={`rounded-md border border-border px-3 py-2 text-sm outline-none ${
            options.length > 0
              ? "bg-muted text-muted-foreground cursor-not-allowed select-none"
              : "bg-card focus:border-primary"
          }`}
        />
        {options.length > 0 && (
          <p className="text-[11px] text-muted-foreground italic">Ce prix est automatiquement synchronisé avec le prix de la 1ère variante.</p>
        )}
      </div>

      {/* Options dynamiques */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            Options <span className="text-xs font-normal text-muted-foreground">(taille, variante…) — optionnel</span>
          </label>
          <button
            type="button"
            onClick={addOption}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3 w-3" /> Ajouter
          </button>
        </div>

        {options.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            {/* Header labels */}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Label (ex: S, M, L)</span>
              <span>Prix (DA)</span>
              <span />
            </div>
            {options.map((opt, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <input
                  type="text"
                  placeholder="Ex: Large"
                  value={opt.label}
                  onChange={(e) => updateOption(i, "label", e.target.value)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={opt.price}
                  onChange={(e) => updateOption(i, "price", e.target.value)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="grid place-items-center rounded-md p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ingrédients */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          Ingrédients <span className="text-xs font-normal text-muted-foreground">— optionnel</span>
        </label>
        <textarea
          rows={2}
          placeholder="Ex: Tomate, Mozzarella, Basilic, Huile d'olive…"
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary resize-none"
        />
      </div>

      {/* Disponible */}
      <div className="flex items-center gap-2">
        <input
          id="available-toggle"
          type="checkbox"
          checked={available}
          onChange={(e) => setAvailable(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-primary"
        />
        <label htmlFor="available-toggle" className="text-sm font-medium cursor-pointer">Disponible</label>
      </div>

      {/* Image */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Image du produit</label>
        <ImageUploader value={image} onChange={(val) => {
          setImage(val);
          setHasCustomImage(true);
        }} />
      </div>

      <div className="mt-2 flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">Annuler</button>
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
