import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMenuStore } from "@/lib/menuStore";
import { formatDA } from "@/data/menu";
import { ChefHat, Sparkles, UtensilsCrossed } from "lucide-react";

export const Route = createFileRoute("/menu")({
  component: MenuPublicPage,
});

function MenuPublicPage() {
  const { categories, products, loading } = useMenuStore();
  const [activeCategory, setActiveCategory] = useState<string>("");
  const pillsRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      setActiveCategory(categories[0].name);
    }
  }, [categories, activeCategory]);

  // Scroll active pill into view
  useEffect(() => {
    if (!pillsRef.current || !activeCategory) return;
    const btn = pillsRef.current.querySelector(`[data-cat="${activeCategory}"]`) as HTMLElement | null;
    btn?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeCategory]);

  const visibleProducts = products.filter((p) =>
    activeCategory === "Tous" || p.category === activeCategory
  );

  // ── Group products by category for "Tous" mode
  const groupedByCategory = categories.map((cat) => ({
    cat,
    items: products.filter((p) => p.category === cat.name),
  })).filter((g) => g.items.length > 0);

  if (loading) {
    return (
      <div className="menu-loading">
        <div className="menu-loading-inner">
          <div className="menu-loader-ring" />
          <p className="menu-loader-text">Chargement du menu…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="menu-root">

      {/* ── HERO ── */}
      <div className="menu-hero">
        <div className="menu-hero-bg" aria-hidden="true" />
        <div className="menu-hero-content">
          <div className="menu-hero-logo">
            <ChefHat className="menu-hero-logo-icon" />
          </div>
          <h1 className="menu-hero-title">Z-PEKENIO</h1>
          <p className="menu-hero-subtitle">
            <Sparkles className="menu-hero-sparkle" />
            Découvrez notre carte
            <Sparkles className="menu-hero-sparkle" />
          </p>
        </div>
      </div>

      {/* ── STICKY CATEGORY NAV ── */}
      <nav className="menu-nav">
        <div
          ref={pillsRef}
          className="menu-pills"
        >
          <button
            data-cat="Tous"
            onClick={() => setActiveCategory("Tous")}
            className={`menu-pill${activeCategory === "Tous" ? " menu-pill--active" : ""}`}
          >
            Tout voir
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              data-cat={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={`menu-pill${activeCategory === cat.name ? " menu-pill--active" : ""}`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </nav>

      {/* ── PRODUCTS ── */}
      <main className="menu-main">
        {activeCategory === "Tous" ? (
          // All categories grouped
          groupedByCategory.map(({ cat, items }) => (
            <section
              key={cat.id}
              className="menu-section"
              ref={(el) => { sectionRefs.current[cat.name] = el; }}
            >
              <div className="menu-section-header">
                <h2 className="menu-section-title">{cat.name}</h2>
                <div className="menu-section-line" />
              </div>
              <div className="menu-grid">
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <section className="menu-section">
            <div className="menu-section-header">
              <h2 className="menu-section-title">{activeCategory}</h2>
              <div className="menu-section-line" />
            </div>
            <div className="menu-grid">
              {visibleProducts.length === 0 ? (
                <div className="menu-empty">
                  <UtensilsCrossed className="menu-empty-icon" />
                  <p className="menu-empty-text">Aucun produit disponible.</p>
                </div>
              ) : (
                visibleProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))
              )}
            </div>
          </section>
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer className="menu-footer">
        <ChefHat className="menu-footer-icon" />
        <p className="menu-footer-text">
          © {new Date().getFullYear()} Z-pekenio &nbsp;·&nbsp; Tous droits réservés
        </p>
      </footer>
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ product }: { product: ReturnType<typeof useMenuStore.getState>["products"][number] }) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <article className={`menu-card${!product.available ? " menu-card--unavailable" : ""}`}>
      {/* Image */}
      <div className="menu-card-img-wrap">
        {product.image ? (
          <>
            {!imgLoaded && <div className="menu-card-img-skeleton" />}
            <img
              src={product.image}
              alt={product.name}
              className={`menu-card-img${imgLoaded ? " menu-card-img--loaded" : ""}`}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          </>
        ) : (
          <div className="menu-card-img-placeholder">
            <ChefHat className="menu-card-placeholder-icon" />
          </div>
        )}

        {/* Unavailable overlay */}
        {!product.available && (
          <div className="menu-card-unavailable-overlay">
            <span className="menu-card-unavailable-badge">Épuisé</span>
          </div>
        )}

        {/* Price badge (no options) — overlaid on image bottom */}
        {(!product.options || product.options.length === 0) && (
          <div className="menu-card-price-badge">
            {formatDA(product.price)}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="menu-card-body">
        <h3 className="menu-card-name">{product.name}</h3>

        {product.ingredients && (
          <p className="menu-card-ingredients">{product.ingredients}</p>
        )}

        {/* Options */}
        {product.options && product.options.length > 0 && (
          <div className="menu-card-options">
            {product.options.map((opt) => (
              <div key={opt.label} className="menu-card-option-row">
                <span className="menu-card-option-label">{opt.label}</span>
                <span className="menu-card-option-price">{formatDA(opt.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
