/**
 * Pure ESC/POS ticket builders (no Bluetooth).
 * Used to prebuild Uint8Array payloads for the print queue.
 */

import type { CartItem } from "@/lib/cart";
import type { GlobalSupplement } from "@/lib/globalSupplementsStore";

const ESC = "\x1b";
const GS = "\x1d";
const INIT = ESC + "@";
const ALIGN_CENTER = ESC + "a" + "\x01";
const ALIGN_LEFT = ESC + "a" + "\x00";
const BOLD_ON = ESC + "E" + "\x01";
const BOLD_OFF = ESC + "E" + "\x00";
const DOUBLE_HEIGHT_WIDTH = GS + "!" + "\x11";
const NORMAL_SIZE = GS + "!" + "\x00";
const CUT_PAPER = GS + "V" + "\x41" + "\x03";

export function encodeEscPosText(text: string): Uint8Array {
  const cleanText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/€/g, "EUR");
  return new TextEncoder().encode(cleanText);
}

export function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function buildReceiptEscPos(params: {
  items: CartItem[];
  total: number;
  tableNumber?: string | number;
  globalSupplements?: GlobalSupplement[];
  phone?: string;
}): Uint8Array {
  const { items, total, tableNumber, globalSupplements, phone } = params;
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const LINE_WIDTH = 32;
  const SEP = "-".repeat(LINE_WIDTH) + "\n";
  const justify = (left: string, right: string, width = LINE_WIDTH) => {
    const spaces = width - left.length - right.length;
    return left + " ".repeat(Math.max(0, spaces)) + right;
  };
  const formatNumber = (num: number) =>
    num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

  let ticket = INIT;
  ticket +=
    ALIGN_CENTER +
    DOUBLE_HEIGHT_WIDTH +
    BOLD_ON +
    (tableNumber ? String(tableNumber).toUpperCase() : "NOUVELLE COMMANDE") + "\n" +
    NORMAL_SIZE +
    BOLD_OFF;

  ticket += "\n" + ALIGN_LEFT;
  ticket += justify(`Date : ${dateStr}`, `Heure : ${timeStr}`) + "\n";
  if (phone) {
    ticket += `Tel : ${phone}\n`;
  }
  ticket += SEP + "\n";

  ticket += ALIGN_LEFT + DOUBLE_HEIGHT_WIDTH + BOLD_ON;

  for (const item of items) {
    let name = item.product.name;
    if (item.selectedOption) name = `${name} (${item.selectedOption.label})`;

    ticket += `${item.quantity}x ${name}\n`;

    if (item.supplements.length > 0) {
      ticket += NORMAL_SIZE;
      for (const sup of item.supplements) {
        ticket += `   + ${sup.label}\n`;
      }
      ticket += DOUBLE_HEIGHT_WIDTH;
    }

    if (item.note) {
      ticket += NORMAL_SIZE;
      ticket += `   Note: ${item.note}\n`;
      ticket += DOUBLE_HEIGHT_WIDTH;
    }
    ticket += "\n";
  }

  if (globalSupplements && globalSupplements.length > 0) {
    ticket += NORMAL_SIZE + SEP + BOLD_ON + "Suppléments globaux :\n" + BOLD_OFF;
    for (const supp of globalSupplements) {
      ticket += `+ ${supp.label}\n`;
    }
  }

  ticket += NORMAL_SIZE + SEP;
  ticket += justify("TOTAL", `${formatNumber(total)} DA`) + "\n";
  ticket += "\n\n\n\n";
  ticket += CUT_PAPER;
  return encodeEscPosText(ticket);
}

/**
 * Build a kitchen (four) ESC/POS ticket.
 *
 * Header is LARGE + BOLD:
 *   "A TABLE  #3"    — for dine-in orders
 *   "A EMPORTER  #7" — for takeaway orders
 *
 * Only items whose product.category_id is in allowedCategoryIds are printed
 * (if allowedCategoryIds is empty / undefined → all items are printed).
 *
 * Returns null when no items remain after filtering (nothing to print).
 */
export function buildFourTicket(params: {
  items: CartItem[];
  orderLabel: string | number;
  /** true = dine-in table, false = takeaway */
  isTable: boolean;
  /** Category IDs allowed for this four printer. Empty = print everything. */
  allowedCategoryIds?: string[];
  orderNote?: string;
}): Uint8Array | null {
  const { items, orderLabel, isTable, allowedCategoryIds, orderNote } = params;

  // Filter items by allowed categories.
  // Items without a categoryId (e.g. locally-added without DB round-trip) are
  // always included so the four printer never silently skips them.
  const filteredItems =
    allowedCategoryIds && allowedCategoryIds.length > 0
      ? items.filter(
          (item) =>
            !item.product.categoryId ||                        // pas de catégorie → inclure
            allowedCategoryIds.includes(item.product.categoryId),
        )
      : items;

  // If the filter excluded everything, fall back to all items so the ticket
  // is never silently lost (misconfigured categories).
  const printItems = filteredItems.length > 0 ? filteredItems : items;

  // Nothing to print at all
  if (printItems.length === 0) return null;

  const now = new Date();
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const LINE_WIDTH = 32;
  const SEP = "=".repeat(LINE_WIDTH) + "\n";

  // Large bold header indicating table or takeaway + order number
  const headerLine = isTable
    ? `A TABLE  #${orderLabel}`
    : `A EMPORTER  #${orderLabel}`;

  let ticket = INIT;

  // ── Entête gras + grand ────────────────────────────────────────
  ticket += ALIGN_CENTER + DOUBLE_HEIGHT_WIDTH + BOLD_ON;
  ticket += headerLine + "\n";
  ticket += NORMAL_SIZE + BOLD_OFF;
  ticket += `Heure : ${timeStr}\n`;
  ticket += SEP;

  // ── Articles ──────────────────────────────────────────────────
  ticket += ALIGN_LEFT + DOUBLE_HEIGHT_WIDTH + BOLD_ON;

  for (const item of printItems) {
    let name = item.product.name;
    if (item.selectedOption) name = `${name} (${item.selectedOption.label})`;
    ticket += `${item.quantity}x ${name}\n`;

    if (item.supplements.length > 0) {
      ticket += NORMAL_SIZE;
      for (const sup of item.supplements) {
        ticket += `   + ${sup.label}\n`;
      }
      ticket += DOUBLE_HEIGHT_WIDTH;
    }

    if (item.note) {
      ticket += NORMAL_SIZE;
      ticket += `   ! ${item.note}\n`;
      ticket += DOUBLE_HEIGHT_WIDTH;
    }
    ticket += "\n";
  }

  // ── Note de commande ──────────────────────────────────────────
  if (orderNote) {
    ticket += NORMAL_SIZE + BOLD_ON + `NOTE: ${orderNote}\n` + BOLD_OFF;
  }

  ticket += NORMAL_SIZE + SEP;
  ticket += "\n\n\n\n";
  ticket += CUT_PAPER;
  return encodeEscPosText(ticket);
}
