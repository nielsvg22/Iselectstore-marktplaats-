const SITE_NAME = "iSelectStore";
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

export function buildSeoTitle(productTitle: string): string {
  return truncate(`${productTitle} kopen | ${SITE_NAME}`, TITLE_MAX);
}

export function buildSeoDescription(productTitle: string, fields: Record<string, string>, price: string | undefined): string {
  const parts: string[] = [];
  if (fields.condition) parts.push(`${productTitle} in ${fields.condition.toLowerCase()}`);
  else parts.push(productTitle);
  if (fields.battery_percentage) parts.push(`${fields.battery_percentage}% batterijconditie`);
  if (price) parts.push(`vanaf €${price}`);
  if (fields.warranty_months) parts.push(`incl. ${fields.warranty_months} mnd garantie`);
  let description = parts.join(", ") + ".";
  description = description.charAt(0).toUpperCase() + description.slice(1);
  description += ` Origineel, gecontroleerd en snel geleverd door ${SITE_NAME}.`;
  return truncate(description, DESCRIPTION_MAX);
}
