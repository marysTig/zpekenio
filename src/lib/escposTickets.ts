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
}): Uint8Array {
  const { items, total, tableNumber, globalSupplements } = params;
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
    "Z-PEKENIO\n" +
    NORMAL_SIZE +
    BOLD_OFF;
  ticket += "GOOD FOOD . GOOD MOOD\n\n";
  ticket += "Merci pour votre visite !\n\n";
  ticket += ALIGN_LEFT;
  ticket += " Seddouk, Bejaia\n";
  ticket += " 0778 46 69 14\n";
  ticket += " @zpekenio\n";
  ticket += ALIGN_CENTER;
  ticket += "\nFast Food with Love\n";
  ticket += ALIGN_LEFT;
  ticket += SEP;

  ticket += justify(`Date : ${dateStr}`, `Heure : ${timeStr}`) + "\n";
  const orderNum = tableNumber ? `#${tableNumber}` : "#---";
  ticket += justify(`N\u00b0 Cmd : ${orderNum}`, `Caisse : 01`) + "\n";
  ticket += `Table : ${tableNumber ? String(tableNumber) : "---"}\n`;
  ticket += SEP;

  const formatLine = (qte: string, prod: string, pu: string, tot: string) => {
    const q = qte.padEnd(3);
    const p = prod.padEnd(14).substring(0, 14);
    const u = pu.padStart(6);
    const t = tot.padStart(7);
    return justify("", `${q} ${p} ${u} ${t}`, LINE_WIDTH);
  };

  ticket +=
    ALIGN_CENTER +
    BOLD_ON +
    justify("", "Qté Produit        P.U  Total ", LINE_WIDTH) +
    "\n" +
    BOLD_OFF;
  ticket += SEP;

  for (const item of items) {
    let basePrice = item.selectedOption
      ? item.selectedOption.price
      : item.product.price;
    if (item.customPrice !== undefined) basePrice = item.customPrice;
    const productTotal = basePrice * item.quantity;
    const puStr = formatNumber(basePrice);
    const totStr = formatNumber(productTotal);
    let name = item.product.name;
    if (item.selectedOption) name = `${name} ${item.selectedOption.label}`;
    const MAX_PROD_LEN = 14;

    if (name.length > MAX_PROD_LEN) {
      const words = name.split(" ");
      let currentLine = "";
      const lines: string[] = [];
      for (const word of words) {
        if ((currentLine + word).length > MAX_PROD_LEN) {
          lines.push(currentLine.trim());
          currentLine = word + " ";
        } else {
          currentLine += word + " ";
        }
      }
      if (currentLine) lines.push(currentLine.trim());
      ticket +=
        formatLine(item.quantity.toString(), lines[0] ?? "", puStr, totStr) +
        "\n";
      for (let i = 1; i < lines.length; i++) {
        ticket += formatLine("", lines[i] ?? "", "", "") + "\n";
      }
    } else {
      ticket += formatLine(item.quantity.toString(), name, puStr, totStr) + "\n";
    }
    for (const sup of item.supplements) {
      ticket +=
        justify(`    + ${sup.label}`, formatNumber(sup.price), LINE_WIDTH) +
        "\n";
    }
  }

  if (globalSupplements && globalSupplements.length > 0) {
    ticket += SEP;
    ticket += ALIGN_LEFT + BOLD_ON + "Suppléments globaux :\n" + BOLD_OFF;
    for (const supp of globalSupplements) {
      ticket += justify(`+ ${supp.label}`, formatNumber(supp.price)) + "\n";
    }
  }

  ticket += SEP;
  ticket +=
    ALIGN_CENTER +
    BOLD_ON +
    justify("Sous-total :", `${formatNumber(total)} DA`) +
    "\n" +
    BOLD_OFF;
  ticket +=
    BOLD_ON +
    DOUBLE_HEIGHT_WIDTH +
    justify("TOTAL :", `${formatNumber(total)} DA`) +
    "\n" +
    NORMAL_SIZE +
    BOLD_OFF;
  ticket += SEP;
  ticket += ALIGN_CENTER;
  ticket += "         Merci !\n";
  ticket += "A BIENTOT CHEZ\n";
  ticket += "Z-PEKENIO\n";
  ticket += "♥\n\n\n\n";
  ticket += CUT_PAPER;
  return encodeEscPosText(ticket);
}
