import { query } from "../db";
import { ProductPreview } from "./orchestrator";
import { createAdvertisement, deleteAdvertisement } from "./apiClient";
import { generateMockAdvertisementId } from "./mock";
import { getDecryptedUserToken } from "./connectionService";
import { logSync, humanizeError } from "../logging";
import crypto from "crypto";

function isMockMode(): boolean {
  return (process.env.MARKTPLAATS_ENVIRONMENT || "mock") === "mock";
}

export function computeSyncHash(preview: ProductPreview): string {
  const relevant = JSON.stringify({
    title: preview.marktplaatsTitle,
    description: preview.marktplaatsDescription,
    attributes: preview.attributeResults.map((a) => [a.internalField, a.marktplaatsValue]),
    images: preview.imageUrls,
    price: preview.payloadPreview.priceModel.askingPrice,
  });
  return crypto.createHash("sha256").update(relevant).digest("hex");
}

export async function publishToMarktplaats(shopifyProductId: string, preview: ProductPreview) {
  if (!preview.validation.publishable) {
    throw new Error("Publiceren geweigerd: preflight validatie bevat errors.");
  }

  const mock = isMockMode();
  let advertisementId: string;

  if (mock) {
    advertisementId = generateMockAdvertisementId();
  } else {
    const token = await getDecryptedUserToken();
    if (!token) throw new Error("Geen Marktplaats-verbinding — koppel eerst een account.");
    const ad = await createAdvertisement(preview.payloadPreview, token.accessToken);
    advertisementId = ad.itemId;
  }

  const syncHash = computeSyncHash(preview);

  await query(
    `INSERT INTO marktplaats_product (shopify_product_id, product_type, status, marktplaats_advertisement_id, sync_hash, last_sync_at)
     VALUES ($1,$2,'published',$3,$4, now())
     ON CONFLICT (shopify_product_id) DO UPDATE SET
       status = 'published', marktplaats_advertisement_id = EXCLUDED.marktplaats_advertisement_id,
       sync_hash = EXCLUDED.sync_hash, last_sync_at = now(), updated_at = now()`,
    [shopifyProductId, preview.productType, advertisementId, syncHash]
  );

  await logSync({ shopifyProductId, marktplaatsAdvertisementId: advertisementId, action: "publish", apiOperation: mock ? "mock" : "POST /v2/advertisements" });

  return { advertisementId, mock };
}

/** Marks a product update_required when its computed sync hash no longer matches what was last published (FASE 39). */
export async function checkForUpdates(shopifyProductId: string, preview: ProductPreview): Promise<boolean> {
  const rows = await query<{ sync_hash: string | null; status: string }>("SELECT sync_hash, status FROM marktplaats_product WHERE shopify_product_id = $1", [shopifyProductId]);
  const row = rows[0];
  if (!row || row.status !== "published") return false;

  const currentHash = computeSyncHash(preview);
  const needsUpdate = row.sync_hash !== currentHash;
  if (needsUpdate) {
    await query("UPDATE marktplaats_product SET status = 'update_required', updated_at = now() WHERE shopify_product_id = $1", [shopifyProductId]);
  }
  return needsUpdate;
}

export type SoldBehavior = "manual" | "close_immediately" | "keep_days";

/** FASE 40: stock hitting 0 never hardcodes an immediate delete — behavior is per-product configurable. */
export async function handleSoldOutOfStock(shopifyProductId: string) {
  const rows = await query<{ sold_behavior: SoldBehavior; sold_keep_days: number | null; marktplaats_advertisement_id: string | null }>(
    "SELECT sold_behavior, sold_keep_days, marktplaats_advertisement_id FROM marktplaats_product WHERE shopify_product_id = $1",
    [shopifyProductId]
  );
  const row = rows[0];
  if (!row) return;

  await query("UPDATE marktplaats_product SET status = 'sold', updated_at = now() WHERE shopify_product_id = $1", [shopifyProductId]);
  await logSync({ shopifyProductId, action: "marked_sold", message: `sold_behavior=${row.sold_behavior}` });

  if (row.sold_behavior === "close_immediately" && row.marktplaats_advertisement_id) {
    const mock = isMockMode();
    if (!mock) {
      const token = await getDecryptedUserToken();
      if (token) await deleteAdvertisement(row.marktplaats_advertisement_id, token.accessToken);
    }
    await query("UPDATE marktplaats_product SET status = 'closed', updated_at = now() WHERE shopify_product_id = $1", [shopifyProductId]);
    await logSync({ shopifyProductId, action: "closed_after_sold", apiOperation: mock ? "mock" : "DELETE /v2/advertisements/{itemId}" });
  }
  // "manual" and "keep_days" leave the ad live; a scheduled job (not built
  // yet — see MARKTPLAATS_INTEGRATION.md) would close keep_days ads once
  // sold_keep_days has elapsed.
}
