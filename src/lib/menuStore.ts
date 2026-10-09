import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { type Product } from "@/data/menu";

export type CategoryItem = {
  id: string;
  name: string;
  image: string; // mapped from image_url
  sort_order?: number;
};

// ── Supabase helpers ──────────────────────────────────────────────

async function fetchCategoriesFromDB(): Promise<CategoryItem[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, image_url, created_at, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur chargement catégories:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row["id"] as string,
    name: row["name"] as string,
    image: (row["image_url"] as string | null) ?? "",
    sort_order: (row["sort_order"] as number | null) ?? 0,
  }));
}

async function fetchProductsFromDB(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category_id, price, image_url, available, options, ingredients, created_at, sort_order, categories(id, name)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur chargement produits:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    // Supabase retourne la relation categories comme un objet ou null
    const cat = Array.isArray(row["categories"])
      ? (row["categories"][0] ?? null)
      : (row["categories"] ?? null);

    const categoryId =
      (row["category_id"] as string | null) ??
      (cat?.["id"] as string | null) ??
      undefined;

    return {
      id: row["id"] as string,
      name: row["name"] as string,
      category: (cat?.["name"] as string) ?? "",
      categoryId: categoryId || undefined,
      price: row["price"] as number,
      image: (row["image_url"] as string | null) ?? "",
      available: (row["available"] as boolean) ?? true,
      options: (row["options"] as Product["options"]) ?? undefined,
      ingredients: (row["ingredients"] as string | null) ?? undefined,
      sort_order: (row["sort_order"] as number | null) ?? 0,
    };
  });
}

// ── Global State (Zustand) ────────────────────────────────────────
// Singleton : partagé entre tous les composants, une seule souscription Supabase

type MenuGlobalState = {
  products: Product[];
  categories: CategoryItem[];
  loading: boolean;
  setProducts: (products: Product[]) => void;
  setCategories: (categories: CategoryItem[]) => void;
  setLoading: (loading: boolean) => void;
};

const useMenuGlobalState = create<MenuGlobalState>((set) => ({
  products: [],
  categories: [],
  loading: true,
  setProducts: (products) => set({ products }),
  setCategories: (categories) => set({ categories }),
  setLoading: (loading) => set({ loading }),
}));

// ── Singleton realtime initializer ───────────────────────────────
// Garantit qu'une seule souscription Supabase est créée (quelle que soit
// le nombre de composants appelant useMenuStore)

let _menuInitialized = false;

async function _initMenuStore(
  setCategories: (c: CategoryItem[]) => void,
  setProducts: (p: Product[]) => void,
  setLoading: (l: boolean) => void,
) {
  if (_menuInitialized) {
    // If already initialized but data is empty (e.g. after hard reload), force re-fetch
    const { categories, products } = useMenuGlobalState.getState();
    if (categories.length === 0 && products.length === 0) {
      _menuInitialized = false;
    } else {
      return;
    }
  }
  _menuInitialized = true;

  setLoading(true);
  const [cats, prods] = await Promise.all([
    fetchCategoriesFromDB(),
    fetchProductsFromDB(),
  ]);
  setCategories(cats);
  setProducts(prods);
  setLoading(false);

  const reload = async () => {
    const [c, p] = await Promise.all([fetchCategoriesFromDB(), fetchProductsFromDB()]);
    setCategories(c);
    setProducts(p);
  };

  supabase
    .channel("menu-categories-global")
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, reload)
    .subscribe();

  supabase
    .channel("menu-products-global")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, reload)
    .subscribe();
}

// ── Hook principal ────────────────────────────────────────────────
// API publique identique à l'ancienne version — aucun impact sur les composants

export function useMenuStore() {
  const { products, categories, loading, setProducts, setCategories, setLoading } = useMenuGlobalState();

  // Initialise le store et les souscriptions Realtime une seule fois
  useEffect(() => {
    _initMenuStore(setCategories, setProducts, setLoading);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    const [cats, prods] = await Promise.all([
      fetchCategoriesFromDB(),
      fetchProductsFromDB(),
    ]);
    setCategories(cats);
    setProducts(prods);
  }, [setCategories, setProducts]);

  // ── CRUD Catégories ─────────────────────────────────────────────

  const addCategory = async (cat: Omit<CategoryItem, "id">) => {
    const { error } = await supabase.from("categories").insert({
      name: cat.name,
      image_url: cat.image || null,
    });
    if (error) throw new Error(error.message);
    await reload();
  };

  const updateCategory = async (id: string, cat: Omit<CategoryItem, "id">) => {
    const { error } = await supabase
      .from("categories")
      .update({ name: cat.name, image_url: cat.image || null })
      .eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  const deleteCategory = async (id: string) => {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  // ── Reorder Catégories ──────────────────────────────────────────
  // orderedIds: tableau d'IDs dans le nouvel ordre souhaité
  const reorderCategories = async (orderedIds: string[]) => {
    // Optimistic update in local state
    const currentCats = useMenuGlobalState.getState().categories;
    const reordered = orderedIds
      .map((id) => currentCats.find((c) => c.id === id))
      .filter(Boolean) as CategoryItem[];
    setCategories(reordered.map((c, i) => ({ ...c, sort_order: i })));

    // Persist to DB: batch update each category's sort_order
    const updates = orderedIds.map((id, index) =>
      supabase.from("categories").update({ sort_order: index }).eq("id", id)
    );
    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error);
    if (firstError?.error) throw new Error(firstError.error.message);
  };

  // ── CRUD Produits ───────────────────────────────────────────────

  const addProduct = async (prod: Omit<Product, "id">) => {
    const cat = categories.find((c) => c.name === prod.category);
    const { error } = await supabase.from("products").insert({
      name: prod.name,
      category_id: cat?.id ?? null,
      price: prod.price,
      image_url: prod.image || null,
      available: prod.available,
      options: Array.isArray(prod.options) && prod.options.length > 0 ? prod.options : null,
      ingredients: typeof prod.ingredients === 'string' ? prod.ingredients.trim() || null : null,
    });
    if (error) throw new Error(error.message);
    await reload();
  };

  const updateProduct = async (id: string, prod: Partial<Product>) => {
    const cat = prod.category
      ? categories.find((c) => c.name === prod.category)
      : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};
    if (prod.name !== undefined) payload["name"] = prod.name;
    if (prod.price !== undefined) payload["price"] = prod.price;
    if (prod.image !== undefined) payload["image_url"] = prod.image || null;
    if (prod.available !== undefined) payload["available"] = prod.available;
    if (cat !== undefined) payload["category_id"] = cat.id;
    if (prod.options !== undefined) payload["options"] = Array.isArray(prod.options) && prod.options.length > 0 ? prod.options : null;
    if (prod.ingredients !== undefined) payload["ingredients"] = typeof prod.ingredients === 'string' ? prod.ingredients.trim() || null : null;

    const { error } = await supabase.from("products").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await reload();
  };

  // ── Reorder Produits ────────────────────────────────────────────
  // orderedIds: tableau d'IDs dans le nouvel ordre souhaité (pour la catégorie active)
  const reorderProducts = async (orderedIds: string[]) => {
    // Optimistic update: reorder in local state keeping other categories intact
    const currentProds = useMenuGlobalState.getState().products;
    const orderedSet = new Set(orderedIds);
    const others = currentProds.filter((p) => !orderedSet.has(p.id));
    const reorderedSlice = orderedIds
      .map((id) => currentProds.find((p) => p.id === id))
      .filter(Boolean) as Product[];
    setProducts([...others, ...reorderedSlice.map((p, i) => ({ ...p, sort_order: i }))]);

    // Persist to DB
    const updates = orderedIds.map((id, index) =>
      supabase.from("products").update({ sort_order: index }).eq("id", id)
    );
    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error);
    if (firstError?.error) throw new Error(firstError.error.message);
  };

  // Helper : noms de catégories avec "Tous" en premier
  const allCategoryNames = ["Tous", ...categories.map((c) => c.name)];

  return {
    products,
    categories,
    loading,
    allCategoryNames,
    reload,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    addProduct,
    updateProduct,
    deleteProduct,
    reorderProducts,
  };
}
