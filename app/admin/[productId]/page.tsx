import Link from "next/link";
import { getProduct } from "@/lib/shopify/client";
import { MarktplaatsPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function ProductAdminPage({ params }: { params: { productId: string } }) {
  const product = await getProduct(params.productId);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <Link href="/admin" style={{ color: "#6b7280", fontSize: 13 }}>
        ← Terug naar overzicht
      </Link>
      <h1 style={{ fontSize: 22, marginTop: 8 }}>{product.title}</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>Producttype: {product.product_type}</p>

      <MarktplaatsPanel shopifyProductId={params.productId} productType={product.product_type} />
    </main>
  );
}
