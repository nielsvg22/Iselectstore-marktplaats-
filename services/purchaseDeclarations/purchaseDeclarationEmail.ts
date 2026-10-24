import type { PurchaseDeclaration } from "./purchaseDeclarationService";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Confirmation e-mail sent to the seller, with their signed inkoopverklaring PDF attached. */
export function buildPurchaseDeclarationEmailHtml(declaration: PurchaseDeclaration): { subject: string; html: string; text: string } {
  const name = declaration.voornaam;
  const subject = `Je inkoopverklaring voor ${declaration.product} is ontvangen`;

  const navy = "#1f3049";
  const coral = "#f9858b";
  const coralInk = "#ef6570";
  const muted = "#6b7280";
  const line = "#e7e9ec";
  const soft = "#f7f7f7";

  const amountText = `€ ${declaration.bedrag.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}`;

  const html = `
  <div style="background:${soft};padding:32px 16px;font-family:'Poppins',Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${line};">
      <tr>
        <td style="background:${navy};padding:20px 32px;">
          <img src="cid:iselectstore-logo" alt="iSelectStore" width="150" height="28" style="display:block;height:28px;width:auto;">
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 8px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${coralInk};">Inkoopverklaring ontvangen</p>
          <h1 style="margin:0 0 16px;font-size:21px;line-height:1.35;color:${navy};">Bedankt, ${escapeHtml(name)}!</h1>
          <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:${navy};">
            We hebben je inkoopverklaring voor onderstaand toestel in goede orde ontvangen. Een kopie (met je handtekening) vind je als bijlage bij deze e-mail.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${soft};border-radius:14px;border:1px solid ${line};">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0;font-size:15px;font-weight:700;color:${navy};">${escapeHtml(declaration.product)}</p>
                <p style="margin:4px 0 0;font-size:13px;color:${muted};">Datum van verkoop: ${escapeHtml(
                  new Date(declaration.datumVerkoop).toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" })
                )}</p>
              </td>
              <td align="right" style="padding:16px 18px;">
                <span style="font-size:17px;font-weight:700;color:${coralInk};">${escapeHtml(amountText)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 28px;">
          <hr style="border:0;border-top:1px solid ${line};margin:0 0 18px;" />
          <p style="font-size:12px;color:${muted};line-height:1.6;margin:0;">
            Vragen? Antwoord gerust op deze e-mail, of app ons via WhatsApp. iSelectStore &middot; Oude Apeldoornseweg 45-067, 7333 NR Apeldoorn.
          </p>
        </td>
      </tr>
    </table>
  </div>`;

  const text = [
    "iSelectStore",
    "",
    `Bedankt, ${name}!`,
    "",
    `We hebben je inkoopverklaring voor ${declaration.product} in goede orde ontvangen. Een kopie (met je handtekening) vind je als bijlage.`,
    "",
    `Bedrag: ${amountText}`,
    `Datum van verkoop: ${new Date(declaration.datumVerkoop).toLocaleDateString("nl-NL")}`,
  ].join("\n");

  return { subject, html, text };
}
