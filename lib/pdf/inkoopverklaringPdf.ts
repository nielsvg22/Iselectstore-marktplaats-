import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import type { PurchaseDeclaration } from "@/services/purchaseDeclarations/purchaseDeclarationService";

const NAVY = rgb(0x1f / 255, 0x30 / 255, 0x49 / 255);
const NAVY_LIGHT = rgb(0x2a / 255, 0x3f / 255, 0x63 / 255);
const CORAL = rgb(0xf9 / 255, 0x85 / 255, 0x8b / 255);
const CORAL_INK = rgb(0xef / 255, 0x65 / 255, 0x70 / 255);
const CORAL_SOFT = rgb(0xfd / 255, 0xec / 255, 0xeb / 255);
const GREEN = rgb(0x22 / 255, 0xc5 / 255, 0x5e / 255);
const GREEN_SOFT = rgb(0xdc / 255, 0xfc / 255, 0xe7 / 255);
const INK = rgb(0x25 / 255, 0x29 / 255, 0x2d / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LINE = rgb(0xe7 / 255, 0xe9 / 255, 0xec / 255);
const SOFT = rgb(0xf7 / 255, 0xf8 / 255, 0xfa / 255);
const SHADOW = rgb(0xe4 / 255, 0xe6 / 255, 0xea / 255);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;

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

function roundedRectPath(w: number, h: number, r: number): string {
  return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
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

/**
 * Renders a signed purchase declaration as a single-page, branded A4 PDF.
 *
 * All drawing is queued into `ops` (executed in insertion order, last on
 * top) rather than drawn immediately, because the final body-card height
 * isn't known until every section above it has been laid out — this lets us
 * draw the white rounded card + shadow BEHIND the content even though we
 * only learn its size after the content itself was positioned.
 */
export async function generateInkoopverklaringPdf(declaration: PurchaseDeclaration): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Inkoopverklaring #${declaration.id} — ${declaration.voornaam} ${declaration.achternaam}`);
  doc.setAuthor("iSelectStore");
  doc.setSubject(declaration.product);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const ops: Array<() => void> = [];
  // y is tracked as "distance from the top of the page" throughout —
  // toY() converts it to PDF's bottom-up coordinate only at the draw call.
  const toY = (fromTop: number) => PAGE_H - fromTop;

  function roundedRect(topY: number, x: number, w: number, h: number, r: number, color = WHITE, borderColor?: ReturnType<typeof rgb>, borderWidth = 1) {
    ops.push(() => page.drawSvgPath(roundedRectPath(w, h, r), { x, y: toY(topY), color, borderColor, borderWidth }));
  }
  function circle(topY: number, cx: number, r: number, color: ReturnType<typeof rgb>) {
    ops.push(() => page.drawEllipse({ x: cx, y: toY(topY), xScale: r, yScale: r, color }));
  }
  function text(str: string, topY: number, x: number, size: number, font: PDFFont, color = INK) {
    ops.push(() => page.drawText(str, { x, y: toY(topY) - size * 0.72, size, font, color }));
  }
  function textRight(str: string, topY: number, rightX: number, size: number, font: PDFFont, color = INK) {
    const w = font.widthOfTextAtSize(str, size);
    text(str, topY, rightX - w, size, font, color);
  }
  function line(topY: number, x1: number, x2: number, color = LINE, thickness = 1) {
    ops.push(() => page.drawLine({ start: { x: x1, y: toY(topY) }, end: { x: x2, y: toY(topY) }, thickness, color }));
  }

  // --- Simple glyph icons, drawn centered at (cx, topY) ------------------
  // All built from drawEllipse/drawRectangle/drawLine only (never
  // drawSvgPath) since those three have unambiguous, verified centering
  // math (ellipse: x/y = center; rectangle: y = bottom edge, so a rect of
  // height H centered on cy needs y = cy - H/2) — drawSvgPath's anchor
  // behaves differently and was the cause of every badly-centered icon.
  function rectCentered(cx: number, cy: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, color, borderWidth: 0 });
  }

  function iconPerson(cx: number, topY: number, color = INK) {
    ops.push(() => {
      const y = toY(topY);
      page.drawEllipse({ x: cx, y: y + 3, xScale: 2.4, yScale: 2.4, color });
      page.drawEllipse({ x: cx, y: y - 3, xScale: 4.6, yScale: 3.6, color });
    });
  }
  function iconPin(cx: number, topY: number, color = INK) {
    ops.push(() => {
      const y = toY(topY);
      page.drawEllipse({ x: cx, y, xScale: 5.5, yScale: 5.5, color });
      page.drawEllipse({ x: cx, y, xScale: 2, yScale: 2, color: WHITE });
    });
  }
  function iconEnvelope(cx: number, topY: number, color = INK) {
    ops.push(() => {
      const y = toY(topY);
      rectCentered(cx, y, 15, 11, color);
      page.drawLine({ start: { x: cx - 6.5, y: y + 4.5 }, end: { x: cx, y: y - 1 }, thickness: 1.1, color: WHITE });
      page.drawLine({ start: { x: cx, y: y - 1 }, end: { x: cx + 6.5, y: y + 4.5 }, thickness: 1.1, color: WHITE });
    });
  }
  function iconBuilding(cx: number, topY: number, color = INK) {
    ops.push(() => {
      const y = toY(topY);
      rectCentered(cx, y, 13, 15, color);
      const dots: [number, number][] = [
        [-3.3, 4.5], [0, 4.5], [3.3, 4.5],
        [-3.3, 0.5], [0, 0.5], [3.3, 0.5],
        [-3.3, -3.5], [0, -3.5], [3.3, -3.5],
      ];
      dots.forEach(([dx, dy]) => rectCentered(cx + dx, y + dy, 1.8, 1.8, WHITE));
    });
  }
  function iconTag(cx: number, topY: number, color = INK) {
    ops.push(() => {
      const y = toY(topY);
      page.drawEllipse({ x: cx, y, xScale: 6, yScale: 6, color });
      page.drawEllipse({ x: cx + 1.6, y: y + 1.6, xScale: 1.6, yScale: 1.6, color: WHITE });
    });
  }
  function iconLock(cx: number, topY: number, color = WHITE) {
    ops.push(() => {
      const y = toY(topY);
      // Shackle, drawn as a bracket from three thin bars (no partial-arc
      // primitive available, and this reads cleanly at icon size).
      rectCentered(cx - 3, y + 4.5, 1.6, 6, color);
      rectCentered(cx + 3, y + 4.5, 1.6, 6, color);
      rectCentered(cx, y + 7, 7.6, 1.6, color);
      rectCentered(cx, y - 2, 11, 8, color);
    });
  }
  function iconCheck(cx: number, topY: number, color = WHITE) {
    ops.push(() => {
      const y = toY(topY);
      page.drawLine({ start: { x: cx - 3.2, y }, end: { x: cx - 0.8, y: y - 2.6 }, thickness: 1.6, color });
      page.drawLine({ start: { x: cx - 0.8, y: y - 2.6 }, end: { x: cx + 3.6, y: y + 3 }, thickness: 1.6, color });
    });
  }

  const cardX = MARGIN;
  const cardW = PAGE_W - MARGIN * 2;

  // =========================================================================
  // HEADER — rounded navy card with logo + title
  // =========================================================================
  const headerH = 84;
  let y = MARGIN;

  roundedRect(y, cardX, cardW, headerH, 18, NAVY);
  for (let i = 0; i < 5; i++) {
    const lx = cardX + cardW * 0.55 + i * 22;
    const topY = y;
    ops.push(() =>
      page.drawLine({
        start: { x: lx, y: toY(topY) },
        end: { x: lx - 60, y: toY(topY + headerH) },
        thickness: 1,
        color: NAVY_LIGHT,
        opacity: 0.5,
      })
    );
  }

  const logoBytes = fs.readFileSync(path.join(process.cwd(), "lib/pdf/assets/iselectstore-logo-white.png"));
  const logoImage = await doc.embedPng(logoBytes);
  const logoColorBytes = fs.readFileSync(path.join(process.cwd(), "lib/pdf/assets/iselectstore-logo.png"));
  const logoColorImage = await doc.embedPng(logoColorBytes);
  const logoW = 132;
  const logoH = (logoImage.height / logoImage.width) * logoW;
  {
    const topY = y;
    ops.push(() => page.drawImage(logoImage, { x: cardX + 28, y: toY(topY + headerH / 2 + logoH / 2 + 6), width: logoW, height: logoH }));
  }

  const title = "Inkoopverklaring";
  textRight(title, y + 32, cardX + cardW - 28, 22, bold, WHITE);
  const sub = `#${String(declaration.id).padStart(5, "0")} · ${formatDate(declaration.createdAt)}`;
  textRight(sub, y + 60, cardX + cardW - 28, 11, regular, rgb(0.82, 0.85, 0.91));

  y += headerH + 16;

  // =========================================================================
  // BODY — rounded white card (rest of the content), with a soft shadow
  // =========================================================================
  const bodyTop = y;
  const bodyPad = 26;
  const innerW = cardW - bodyPad * 2;
  let cy = bodyTop + bodyPad;

  function sectionHeading(label: string) {
    text(label, cy, cardX + bodyPad, 13, bold, NAVY);
    cy += 19;
  }
  function divider() {
    line(cy, cardX + bodyPad, cardX + cardW - bodyPad, LINE, 1);
    cy += 18;
  }

  function iconField(x: number, colW: number, iconDraw: (cx: number, topY: number) => void, label: string, value: string) {
    const iconCx = x + 15;
    circle(cy + 15, iconCx, 15, CORAL_SOFT);
    iconDraw(iconCx, cy + 15);
    text(label.toUpperCase(), cy + 7, x + 40, 8, bold, MUTED);
    const maxValW = colW - 44;
    const valueLines = wrapText(value || "—", bold, 11.5, maxValW);
    valueLines.slice(0, 2).forEach((ln, i) => text(ln, cy + 22 + i * 13, x + 40, 11.5, bold, INK));
  }

  // --- Verkoper ---
  sectionHeading("Verkoper");
  const colW = innerW / 2;
  const rowTop1 = cy;
  iconField(cardX + bodyPad, colW, iconPerson, "Naam", `${declaration.voornaam} ${declaration.achternaam}`);
  cy = rowTop1;
  iconField(cardX + bodyPad + colW, colW, iconEnvelope, "E-mailadres", declaration.email || "—");
  const rowTop2 = rowTop1 + 38;
  cy = rowTop2;
  iconField(cardX + bodyPad, colW, iconPin, "Adres", declaration.adres);
  cy = rowTop2;
  iconField(cardX + bodyPad + colW, colW, iconBuilding, "Postcode / Plaats", `${declaration.postcode} ${declaration.woonplaats}`);
  cy = rowTop2 + 38 + 6;
  divider();

  // --- Verkochte product ---
  sectionHeading("Verkochte product");
  const productBoxH = 72;
  roundedRect(cy, cardX + bodyPad, innerW, productBoxH, 14, CORAL_SOFT);
  const prodIconCx = cardX + bodyPad + 28;
  circle(cy + 36, prodIconCx, 15, WHITE);
  iconTag(prodIconCx, cy + 36, CORAL_INK);
  text(declaration.product, cy + 25, cardX + bodyPad + 56, 13, bold, NAVY);
  text(`Datum van verkoop: ${formatDate(declaration.datumVerkoop)}`, cy + 45, cardX + bodyPad + 56, 9.5, regular, MUTED);
  const dividerX = cardX + bodyPad + innerW - 150;
  const productBoxTop = cy;
  ops.push(() =>
    page.drawLine({
      start: { x: dividerX, y: toY(productBoxTop + 14) },
      end: { x: dividerX, y: toY(productBoxTop + productBoxH - 14) },
      thickness: 1,
      color: rgb(0.93, 0.78, 0.79),
    })
  );
  const priceRight = cardX + bodyPad + innerW - 22;
  textRight("Verkoopprijs", cy + 25, priceRight, 9, bold, MUTED);
  const amountText = formatCurrency(declaration.bedrag);
  textRight(amountText, cy + 43, priceRight, 19, bold, CORAL_INK);
  cy += productBoxH + 16;
  divider();

  // --- Verklaringen ---
  sectionHeading("Verklaringen");
  const declarations: [boolean, string][] = [
    [
      declaration.verklaringEigenaar,
      "Hierbij verklaar ik als verkoper dat ik de rechtmatige eigenaar ben van de in deze inkoopverklaring gemelde goederen, geen omzetbelasting heb afgetrokken met betrekking tot deze levering, en minstens 18 jaar oud ben.",
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
  const declTextW = innerW - 58;
  const rowStartY = cy;
  const rowHeights: number[] = declarations.map(([, t]) => wrapText(t, regular, 10, declTextW).length * 13 + 20);
  const totalDeclH = rowHeights.reduce((a, b) => a + b, 0);
  roundedRect(rowStartY, cardX + bodyPad, innerW, totalDeclH, 14, WHITE, LINE, 1);
  let rowY = rowStartY;
  declarations.forEach(([checked, declText], i) => {
    const rh = rowHeights[i];
    const checkCx = cardX + bodyPad + 28;
    const checkTopY = rowY + rh / 2 - 7;
    roundedRect(checkTopY, checkCx - 7, 14, 14, 4, checked ? CORAL : WHITE, checked ? CORAL : rgb(0.8, 0.82, 0.85), 1.2);
    if (checked) iconCheck(checkCx, checkTopY + 9);
    const lines = wrapText(declText, regular, 10, declTextW);
    const textTop = rowY + (rh - lines.length * 13) / 2 + 2;
    lines.forEach((ln, li) => text(ln, textTop + li * 13, cardX + bodyPad + 50, 10, regular, INK));
    if (i < declarations.length - 1) {
      line(rowY + rh, cardX + bodyPad + 20, cardX + bodyPad + innerW - 20, LINE, 1);
    }
    rowY += rh;
  });
  cy = rowStartY + totalDeclH + 18;
  divider();

  // --- Handtekening ---
  sectionHeading("Handtekening");
  const sigBoxW = innerW * 0.48;
  const sigBoxH = 86;
  const sigRowTop = cy;
  roundedRect(sigRowTop, cardX + bodyPad, sigBoxW, sigBoxH, 14, WHITE, LINE, 1.2);
  if (declaration.handtekening?.startsWith("data:image/")) {
    try {
      const base64 = declaration.handtekening.split(",")[1] || "";
      const sigBytes = Buffer.from(base64, "base64");
      const sigImage = declaration.handtekening.startsWith("data:image/png") ? await doc.embedPng(sigBytes) : await doc.embedJpg(sigBytes);
      const maxW = sigBoxW - 32;
      const maxH = sigBoxH - 32;
      let w = maxW;
      let h = (sigImage.height / sigImage.width) * w;
      if (h > maxH) {
        h = maxH;
        w = (sigImage.width / sigImage.height) * h;
      }
      const drawX = cardX + bodyPad + (sigBoxW - w) / 2;
      const drawTopY = sigRowTop + sigBoxH / 2 + h / 2;
      ops.push(() => page.drawImage(sigImage, { x: drawX, y: toY(drawTopY), width: w, height: h }));
    } catch {
      text("(handtekening kon niet worden geladen)", sigRowTop + sigBoxH / 2, cardX + bodyPad + 16, 9.5, regular, MUTED);
    }
  }

  const badgeX = cardX + bodyPad + sigBoxW + 20;
  const badgeW = innerW - sigBoxW - 20;
  roundedRect(sigRowTop, badgeX, badgeW, sigBoxH, 14, SOFT);
  const lockCx = badgeX + 30;
  circle(sigRowTop + 32, lockCx, 15, GREEN_SOFT);
  iconLock(lockCx, sigRowTop + 32, GREEN);
  text("Digitaal ondertekend door", sigRowTop + 22, badgeX + 56, 9.5, regular, MUTED);
  const signerLines = wrapText(`${declaration.voornaam} ${declaration.achternaam}`, bold, 12, badgeW - 64);
  signerLines.forEach((ln, i) => text(ln, sigRowTop + 38 + i * 14, badgeX + 56, 12, bold, NAVY));
  text(`op ${formatDateTime(declaration.createdAt)}.`, sigRowTop + 38 + signerLines.length * 14 + 4, badgeX + 56, 9, regular, MUTED);

  cy = sigRowTop + sigBoxH;

  // --- Footer ---
  const footerTop = cy + 26;
  line(footerTop, cardX + bodyPad, cardX + cardW - bodyPad, LINE, 1);
  const footLogoW = 96;
  const footLogoH = (logoColorImage.height / logoColorImage.width) * footLogoW;
  {
    const topY = footerTop + 36 + footLogoH / 2;
    ops.push(() => page.drawImage(logoColorImage, { x: cardX + bodyPad, y: toY(topY), width: footLogoW, height: footLogoH }));
  }

  const footInfoX = cardX + bodyPad + footLogoW + 36;
  iconPin(footInfoX + 5, footerTop + 26, MUTED);
  text("Oude Apeldoornseweg 45-067, 7333 NR Apeldoorn", footerTop + 29, footInfoX + 18, 8.5, regular, MUTED);
  iconEnvelope(footInfoX + 5, footerTop + 50, MUTED);
  text("info@iselectstore.nl", footerTop + 53, footInfoX + 18, 8.5, regular, MUTED);

  const footRight = cardX + cardW - bodyPad;
  textRight("KVK 84268891", footerTop + 29, footRight, 8.5, regular, MUTED);
  textRight("BTW NL003937269B13", footerTop + 53, footRight, 8.5, regular, MUTED);

  // =========================================================================
  // Now that every section's position is known, draw the body card's shadow
  // and white rounded background FIRST (so it's behind all queued content),
  // then flush the queued content on top of it in order.
  // =========================================================================
  const bodyCardBottom = footerTop + 70;
  const bodyCardH = bodyCardBottom - bodyTop;
  page.drawSvgPath(roundedRectPath(cardW, bodyCardH, 18), { x: cardX + 2, y: toY(bodyTop) - 2, color: SHADOW });
  page.drawSvgPath(roundedRectPath(cardW, bodyCardH, 18), { x: cardX, y: toY(bodyTop), color: WHITE });

  ops.forEach((op) => op());

  return doc.save();
}
