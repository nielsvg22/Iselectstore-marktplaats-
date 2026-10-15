// Shared guard + query-hulper + statusvertalingen voor de ingelogde
// portaalpagina's (server components).
import { redirect } from "next/navigation";
import { CaAuthError, caQuery, getSession, type CaResult } from "@/lib/customerAccount";
import { coral, muted, navy } from "../stijl";

export function eisInlog() {
  const s = getSession();
  if (!s) redirect("/portaal/inloggen");
  return s;
}

export async function portaalQuery<T>(query: string, variables?: Record<string, unknown>): Promise<CaResult<T>> {
  eisInlog();
  try {
    return await caQuery<T>(query, variables);
  } catch (err) {
    if (err instanceof CaAuthError) redirect("/portaal/uitloggen");
    throw err;
  }
}

export type Status = { tekst: string; kleur: string };

const FULFILMENT: Record<string, Status> = {
  UNFULFILLED: { tekst: "In behandeling", kleur: coral },
  IN_PROGRESS: { tekst: "In behandeling", kleur: coral },
  PARTIALLY_FULFILLED: { tekst: "Gedeeltelijk verzonden", kleur: coral },
  FULFILLED: { tekst: "Verzonden", kleur: navy },
  SCHEDULED: { tekst: "Gepland", kleur: coral },
  ON_HOLD: { tekst: "On hold", kleur: coral },
  PENDING_FULFILLMENT: { tekst: "In behandeling", kleur: coral },
};

const FINANCIAL: Record<string, Status> = {
  PAID: { tekst: "Betaald", kleur: navy },
  AUTHORIZED: { tekst: "Goedgekeurd", kleur: navy },
  PENDING: { tekst: "In afwachting", kleur: coral },
  PARTIALLY_PAID: { tekst: "Deels betaald", kleur: coral },
  UNPAID: { tekst: "Nog niet betaald", kleur: coral },
  PARTIALLY_REFUNDED: { tekst: "Deels terugbetaald", kleur: muted },
  REFUNDED: { tekst: "Terugbetaald", kleur: muted },
  VOIDED: { tekst: "Geannuleerd", kleur: muted },
  EXPIRED: { tekst: "Verlopen", kleur: muted },
};

const ANNULERING: Record<string, string> = {
  DECLINED: "Geweigerd",
  FRAUD: "Fraude",
  INVENTORY: "Geen voorraad",
  CUSTOMER: "Klantannulering",
  OTHER: "Anders",
};

export function vertaalFulfillment(status: string | null | undefined): Status {
  if (!status) return { tekst: "Onbekend", kleur: muted };
  return FULFILMENT[status] || { tekst: status.toLowerCase().replace(/_/g, " "), kleur: muted };
}

export function vertaalFinancial(status: string | null | undefined): Status {
  if (!status) return { tekst: "Onbekend", kleur: muted };
  return FINANCIAL[status] || { tekst: status.toLowerCase().replace(/_/g, " "), kleur: muted };
}

export function vertaalAnnulering(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return ANNULERING[reason] || "Geannuleerd";
}

// Types voor de portaal-queries (CA API 2026-10).
export type Geld = { amount: string; currencyCode: string } | null;

export type OverzichtKlant = {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
    emailAddress: { emailAddress: string } | null;
    orders: {
      nodes: {
        id: string;
        name: string;
        processedAt: string;
        cancelledAt: string | null;
        financialStatus: string | null;
        fulfillmentStatus: string;
        totalPrice: Geld;
      }[];
    };
  } | null;
};

export type BestellingNode = {
  id: string;
  name: string;
  number: number;
  processedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string;
  currencyCode: string;
  statusPageUrl: string;
  email: string | null;
  subtotal: Geld;
  totalPrice: Geld;
  totalShipping: Geld;
  totalRefunded: Geld;
  lineItems: {
    nodes: {
      id: string;
      name: string;
      title: string;
      variantTitle: string | null;
      quantity: number;
      sku: string | null;
      currentTotalPrice: Geld;
      unitPrice: Geld;
      image: { url: string } | null;
    }[];
  };
  shippingAddress: Adres | null;
  billingAddress: Adres | null;
  fulfillments: {
    nodes: {
      status: string;
      trackingInformation: { number: string | null; url: string | null; company: string | null }[];
    }[];
  };
};

type Adres = {
  formatted: string[];
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  country: string | null;
  zip: string | null;
  phone: string | null;
};

export type BestellingenKlant = {
  customer: { orders: { nodes: BestellingNode[] } } | null;
};

export type GegevensKlant = {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
    emailAddress: { emailAddress: string } | null;
    phoneNumber: { phoneNumber: string | null } | null;
    defaultAddress: { id: string } | null;
    addresses: {
      nodes: (Adres & { id: string })[];
    };
  } | null;
};

export function adresTekst(a: Adres | null): string {
  if (!a) return "—";
  if (a.formatted?.length) return a.formatted.join("\n");
  return [a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : "", a.address1, a.address2, `${a.zip || ""} ${a.city || ""}`.trim(), a.country]
    .filter(Boolean)
    .join("\n");
}
