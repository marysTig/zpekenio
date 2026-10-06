import type { Product, ProductOption } from "@/data/menu";

export type CartItem = {
  id: string;
  product: Product;
  quantity: number;
  note?: string | undefined;
  supplements: { id: string; label: string; price: number }[];
  selectedOption?: ProductOption | undefined; // option choisie (taille/variante)
  customPrice?: number | undefined; // prix modifié manuellement
  /** @deprecated Legacy kitchen-print fields — ignored in receipts-only mode */
  kitchenFingerprint?: string | null | undefined;
  kitchenPrintedAt?: string | null | undefined;
};

export function lineTotal(item: CartItem) {
  const extras = item.supplements.reduce((sum, s) => sum + s.price, 0);
  // Si une option est sélectionnée, son prix remplace le prix de base du produit
  let basePrice = item.selectedOption ? item.selectedOption.price : item.product.price;
  if (item.customPrice !== undefined) {
    basePrice = item.customPrice;
  }
  return (basePrice * item.quantity) + extras;
}

export function cartSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}
