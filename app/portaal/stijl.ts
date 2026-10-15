// Gedeelde huisstijl-tokens van het klantportaal (spiegelt theme.css:
// Poppins, navy #1f3049, coral #f9858b, ivory #f7f7f7, line #e7e9ec).
import type { CSSProperties } from "react";

export const navy = "#1f3049";
export const coral = "#f9858b";
export const coralInk = "#ef6570";
export const ivory = "#f7f7f7";
export const line = "#e7e9ec";
export const muted = "#6b7280";

export const kaart: CSSProperties = {
  background: "#fff",
  border: `1px solid ${line}`,
  borderRadius: 16,
  padding: "18px 20px",
};

export const knoopPrimair: CSSProperties = {
  display: "inline-block",
  background: coral,
  color: "#fff",
  border: "none",
  borderRadius: 980,
  padding: "11px 22px",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
};

export const knoopGhost: CSSProperties = {
  display: "inline-block",
  background: "transparent",
  color: navy,
  border: `1px solid ${line}`,
  borderRadius: 980,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
};

export const chip = (kleur: string): CSSProperties => ({
  display: "inline-block",
  background: `${kleur}14`,
  color: kleur,
  border: `1px solid ${kleur}33`,
  borderRadius: 980,
  padding: "3px 10px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
});

export const labelStijl: CSSProperties = {
  fontSize: 12,
  color: muted,
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 4,
};

export function formatEuro(bedrag: string | number | null | undefined): string {
  const n = typeof bedrag === "string" ? parseFloat(bedrag) : bedrag;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" }).format(d);
}
