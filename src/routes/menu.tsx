import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMenuStore } from "@/lib/menuStore";
import { formatDA } from "@/data/menu";
import { ChefHat } from "lucide-react";

export const Route = createFileRoute("/menu")({
  component: MenuPublicPage,
});

function MenuPublicPage() {
  const { categories, products, loading } = useMenuStore();
  const [activeCategory, setActiveCategory] = useState<string>("");

  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      setActiveCategory(categories[0].name);
    }
  }, [categories, activeCategory]);

  const visibleProducts = products.filter((product) => {
    return activeCategory === "Tous" || product.category === activeCategory;
  });

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Chargement du menu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans overflow-x-hidden">
      {/* ── HEADER BANNÈRE ── */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border shadow-sm">
        <div className="flex items-center justify-center gap-3 py-3 md:py-4">
          <div className="grid h-9 w-9 md:h-10 md:w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <ChefHat className="h-5 w-5 md:h-6 md:w-6" />
          </div>
          <h1 className="text-lg md:text-xl font-extrabold tracking-tight uppercase">Z-PEKENIO</h1>
        </div>

        {/* ── CATEGORIES (Scroll Horizontal) ── */}
        <div
          className="flex items-center gap-2 overflow-x-auto px-3 pb-3 md:px-4"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <button
            onClick={() => setActiveCategory("Tous")}
            className={`flex-none whitespace-nowrap rounded-full px-4 py-1.5 text-xs md:text-sm font-semibold transition-colors ${
              activeCategory === "Tous"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            Tous
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.name)}
              className={`flex-none whitespace-nowrap rounded-full px-4 py-1.5 text-xs md:text-sm font-semibold transition-colors ${
                activeCategory === cat.name
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* ── LISTE DES PRODUITS ── */}
      <main className="flex-1 w-full min-w-0 px-3 py-4 md:px-6 md:py-6 lg:px-8">
        <div className="mx-auto max-w-4xl w-full min-w-0">

          <h2 className="mb-4 md:mb-6 text-xl md:text-2xl font-bold tracking-tight">
            {activeCategory === "Tous" ? "Notre Menu" : activeCategory}
          </h2>

          {/*
            Grille responsive :
            • < 380px  → 1 colonne (écrans très étroits)
            • ≥ 380px  → 2 colonnes compactes
            • ≥ 768px  → 2 colonnes avec plus d'espace
            • ≥ 1024px → 3 colonnes
          */}
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6 w-full">
            {visibleProducts.map((product) => (
              <div
                key={product.id}
                className={`flex flex-col overflow-hidden rounded-xl md:rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md w-full min-w-0 ${
                  !product.available ? "opacity-60 grayscale-[0.5]" : ""
                }`}
              >
                {/* Photo du produit */}
                <div className="relative w-full bg-muted overflow-hidden" style={{ aspectRatio: "16/9" }}>
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground/30">
                      <ChefHat className="h-8 w-8 md:h-12 md:w-12" />
                    </div>
                  )}
                  {/* Badge Indisponible */}
                  {!product.available && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[2px]">
                      <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] md:text-xs font-bold uppercase tracking-wider text-background shadow-lg">
                        Épuisé
                      </span>
                    </div>
                  )}
                </div>

                {/* Contenu */}
                <div className="flex flex-1 flex-col items-center p-2.5 min-[380px]:p-3 md:p-4 min-w-0 text-center">
                  {/* Nom du produit */}
                  <h3 className="text-sm min-[380px]:text-sm md:text-base font-bold leading-snug whitespace-normal break-words w-full">
                    {product.name}
                  </h3>

                  {/* Prix (sans variantes) */}
                  {(!product.options || product.options.length === 0) && (
                    <span className="mt-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-xs md:text-sm font-extrabold text-primary inline-block">
                      {formatDA(product.price)}
                    </span>
                  )}

                  {/* Description */}
                  {product.ingredients && (
                    <p className="mt-1.5 text-[11px] min-[380px]:text-xs md:text-sm text-muted-foreground line-clamp-2 break-words">
                      {product.ingredients}
                    </p>
                  )}

                  {/* Variantes */}
                  {product.options && product.options.length > 0 && (
                    <div className="mt-2 flex flex-1 flex-col justify-end min-w-0">
                      <div className="h-px w-full bg-border/50 mb-1.5" />
                      {product.options.map((opt) => (
                        <div key={opt.label} className="flex items-center justify-between gap-1 py-0.5 min-w-0">
                          <span className="text-[11px] min-[380px]:text-xs md:text-sm font-medium truncate min-w-0 shrink">
                            {opt.label}
                          </span>
                          <span className="text-[11px] min-[380px]:text-xs md:text-sm font-bold text-primary shrink-0 whitespace-nowrap">
                            {formatDA(opt.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {visibleProducts.length === 0 && (
              <div className="col-span-full py-12 text-center text-muted-foreground">
                <ChefHat className="mx-auto mb-3 h-12 w-12 opacity-20" />
                <p className="text-sm">Aucun produit dans cette catégorie pour le moment.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── FOOTER PUBLIC ── */}
      <footer className="border-t border-border bg-muted/30 py-4 md:py-6 text-center">
        <p className="text-xs md:text-sm font-medium text-muted-foreground">
          © {new Date().getFullYear()} Z-pekenio. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
