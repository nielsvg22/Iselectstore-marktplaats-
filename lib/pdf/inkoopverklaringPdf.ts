import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import type { PurchaseDeclaration } from "@/services/purchaseDeclarations/purchaseDeclarationService";

const NAVY = rgb(0x1f / 255, 0x30 / 255, 0x49 / 255);
const CORAL = rgb(0xf9 / 255, 0x85 / 255, 0x8b / 255);
const INK = rgb(0x25 / 255, 0x29 / 255, 0x2d / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LINE = rgb(0xe7 / 255, 0xe9 / 255, 0xec / 255);
const SOFT = rgb(0xf7 / 255, 0xf7 / 255, 0xf7 / 255);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

function formatCurrency(amount: number): string {
  return `€ ${amount.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Renders a signed purchase declaration as a single-page, branded A4 PDF. */
export async function generateInkoopverklaringPdf(declaration: PurchaseDeclaration): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Inkoopverklaring #${declaration.id} — ${declaration.voornaam} ${declaration.achternaam}`);
  doc.setAuthor("iSelectStore");
  doc.setSubject(declaration.product);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  let y = PAGE_H;

  // --- Header band -----------------------------------------------------
  const headerH = 112;
  page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: NAVY });
  page.drawRectangle({ x: 0, y: PAGE_H - headerH - 4, width: PAGE_W, height: 4, color: CORAL });

  const logoBytes = fs.readFileSync(path.join(process.cwd(), "lib/pdf/assets/iselectstore-logo.png"));
  const logoImage = await doc.embedPng(logoBytes);
  const logoW = 150;
  const logoH = (logoImage.height / logoImage.width) * logoW;
  page.drawImage(logoImage, { x: MARGIN, y: PAGE_H - headerH / 2 - logoH / 2, width: logoW, height: logoH });

  const title = "INKOOPVERKLARING";
  const titleSize = 18;
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, { x: PAGE_W - MARGIN - titleW, y: PAGE_H - 48, size: titleSize, font: bold, color: rgb(1, 1, 1) });

  const sub = `#${String(declaration.id).padStart(5, "0")} · ${formatDate(declaration.createdAt)}`;
  const subSize = 10.5;
  const subW = regular.widthOfTextAtSize(sub, subSize);
  page.drawText(sub, { x: PAGE_W - MARGIN - subW, y: PAGE_H - 66, size: subSize, font: regular, color: rgb(0.85, 0.87, 0.92) });

  y = PAGE_H - headerH - 4 - 36;

  // --- Section helper ----------------------------------------------------
  function sectionTitle(text: string) {
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 10.5, font: bold, color: CORAL });
    y -= 16;
  }

  function fieldRow(pairs: [string, string][]) {
    const colW = (PAGE_W - MARGIN * 2) / pairs.length;
    pairs.forEach(([label, value], i) => {
      const x = MARGIN + i * colW;
      page.drawText(label.toUpperCase(), { x, y, size: 8, font: bold, color: MUTED });
      page.drawText(value || "—", { x, y: y - 14, size: 11.5, font: regular, color: INK });
    });
    y -= 40;
  }

  function divider() {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: LINE });
    y -= 24;
  }

  // --- Verkoper ----------------------------------------------------------
  sectionTitle("Verkoper");
  fieldRow([
    ["Naam", `${declaration.voornaam} ${declaration.achternaam}`],
    ["E-mailadres", declaration.email || "—"],
  ]);
  fieldRow([
    ["Adres", declaration.adres],
    ["Postcode / plaats", `${declaration.postcode} ${declaration.woonplaats}`],
  ]);
  divider();

  // --- Product -------------------------------------------------------
  sectionTitle("Verkochte product");
  const boxTop = y;
  const boxH = 54;
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: PAGE_W - MARGIN * 2, height: boxH, color: SOFT, borderColor: LINE, borderWidth: 1 });
  page.drawText(declaration.product, { x: MARGIN + 16, y: boxTop - 24, size: 13, font: bold, color: NAVY });
  page.drawText(`Datum van verkoop: ${formatDate(declaration.datumVerkoop)}`, { x: MARGIN + 16, y: boxTop - 42, size: 9.5, font: regular, color: MUTED });
  const amountText = formatCurrency(declaration.bedrag);
  const amountSize = 16;
  const amountW = bold.widthOfTextAtSize(amountText, amountSize);
  page.drawText(amountText, { x: PAGE_W - MARGIN - 16 - amountW, y: boxTop - boxH / 2 - amountSize / 2 + 4, size: amountSize, font: bold, color: CORAL });
  y = boxTop - boxH - 28;
  divider();

  // --- Verklaringen --------------------------------------------------
  sectionTitle("Verklaringen");
  const declarations: [boolean, string][] = [
    [
      declaration.verklaringEigenaar,
      "Hierbij verklaar ik als verkoper dat ik de rechtmatige eigenaar ben van de in deze inkoopverklaring vermelde goederen, geen omzetbelasting heb afgetrokken met betrekking tot deze levering, en minstens 18 jaar oud ben.",
    ],
    [
      declaration.verklaringAbonnement,
      "Daarnaast verklaar ik als verkoper dat, indien de in de inkoopverklaring vermelde goederen op abonnement zijn afgesloten, ik het openstaande toestelkrediet zal afbetalen.",
    ],
    [
      declaration.verklaringThuiskopie,
      "Ook verklaar ik dat het toestel wat ik verkoop een Nederlands toestel is waar al wettelijke thuiskopieheffing over betaald is.",
    ],
  ];
  const textW = PAGE_W - MARGIN * 2 - 26;
  for (const [checked, text] of declarations) {
    const lines = wrapText(text, regular, 9.5, textW);
    page.drawRectangle({ x: MARGIN, y: y - 9, width: 11, height: 11, borderColor: checked ? CORAL : MUTED, borderWidth: 1.2, color: checked ? CORAL : rgb(1, 1, 1) });
    if (checked) {
      // Drawn as vector strokes rather than a "✓" glyph: WinAnsi (the
      // standard-font encoding) has no codepoint for it.
      const cx = MARGIN + 5.5;
      const cy = y - 9 + 5.5;
      page.drawLine({ start: { x: cx - 3, y: cy }, end: { x: cx - 1, y: cy - 2.2 }, thickness: 1.3, color: rgb(1, 1, 1) });
      page.drawLine({ start: { x: cx - 1, y: cy - 2.2 }, end: { x: cx + 3.2, y: cy + 3 }, thickness: 1.3, color: rgb(1, 1, 1) });
    }
    lines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN + 26, y: y - i * 13, size: 9.5, font: regular, color: INK });
    });
    y -= lines.length * 13 + 10;
  }
  y -= 10;
  divider();

  // --- Handtekening ----------------------------------------------------
  sectionTitle("Handtekening");
  if (declaration.handtekening?.startsWith("data:image/")) {
    try {
      const base64 = declaration.handtekening.split(",")[1] || "";
      const sigBytes = Buffer.from(base64, "base64");
      const sigImage = declaration.handtekening.startsWith("data:image/png") ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);
      const sigW = 220;
      const sigH = (sigImage.height / sigImage.width) * sigW;
      page.drawRectangle({ x: MARGIN, y: y - sigH - 16, width: sigW + 20, height: sigH + 16, borderColor: LINE, borderWidth: 1 });
      page.drawImage(sigImage, { x: MARGIN + 10, y: y - sigH - 8, width: sigW, height: sigH });
      y -= sigH + 16 + 10;
    } catch {
      page.drawText("(handtekening kon niet worden ingeladen)", { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
      y -= 20;
    }
  }
  page.drawText(`Digitaal ondertekend door ${declaration.voornaam} ${declaration.achternaam} op ${formatDateTime(declaration.createdAt)}.`, {
    x: MARGIN,
    y,
    size: 8.5,
    font: regular,
    color: MUTED,
  });

  // --- Footer -----------------------------------------------------------
  const footerY = 46;
  page.drawLine({ start: { x: MARGIN, y: footerY + 16 }, end: { x: PAGE_W - MARGIN, y: footerY + 16 }, thickness: 1, color: LINE });
  const footerLeft = "iSelectStore · Oude Apeldoornseweg 45-067, 7333 NR Apeldoorn · info@iselectstore.nl";
  const footerRight = "KVK 84268891 · BTW NL003937269B13";
  page.drawText(footerLeft, { x: MARGIN, y: footerY, size: 8, font: regular, color: MUTED });
  const footerRightW = regular.widthOfTextAtSize(footerRight, 8);
  page.drawText(footerRight, { x: PAGE_W - MARGIN - footerRightW, y: footerY, size: 8, font: regular, color: MUTED });

  return doc.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
