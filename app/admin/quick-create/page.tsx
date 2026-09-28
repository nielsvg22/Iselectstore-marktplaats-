import Link from "next/link";
import { listProductTypes } from "@/lib/templates/registry";
import { ShopifyProductType } from "@/lib/templates/types";
import { QuickCreateClient } from "./quickCreateClient";

export const dynamic = "force-dynamic";

interface QuickCreatePageProps {
  // Next 14 levert een plain object; de Promise-vorm wordt meegenomen voor
  // compatibiliteit (zelfde patroon als /diagnostics).
  searchParams: { productType?: string } | Promise<{ productType?: string }>;
}

export default async function QuickCreatePage({ searchParams }: QuickCreatePageProps) {
  const params = await searchParams;
  const known = listProductTypes();
  const requested = typeof params?.productType === "string" ? params.productType : "";
  const initial = (known as readonly string[]).includes(requested)
    ? (requested as ShopifyProductType)
    : known[0];
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN || "";
  const storeSubdomain = storeDomain.split(".")[0] || "";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <Link href="/admin" style={{ color: "#6b7280", fontSize: 13 }}>
        ← Terug naar overzicht
      </Link>
      <h1 style={{ fontSize: 22, marginTop: 8 }}>Nieuw product aanmaken</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Kies een producttype, laat de AI kenmerken uit foto&apos;s herkennen, vul de verplichte velden
        aan en maak het product aan in Shopify.
      </p>
      <QuickCreateClient
        initialProductType={initial}
        knownProductTypes={[...known]}
        storeSubdomain={storeSubdomain}
      />
    </main>
  );
}
