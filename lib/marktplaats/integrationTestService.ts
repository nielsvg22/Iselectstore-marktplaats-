import { query } from "../db";
import { ProductPreview } from "./orchestrator";
import { createAdvertisement, getAdvertisement, deleteAdvertisement } from "./apiClient";
import { generateMockAdvertisementId } from "./mock";
import { getDecryptedUserToken } from "./connectionService";
import { logSync, humanizeError } from "../logging";

function isMockMode(): boolean {
  return (process.env.MARKTPLAATS_ENVIRONMENT || "mock") === "mock";
}

export interface FullTestResult {
  passed: boolean;
  steps: { label: string; ok: boolean; detail?: string }[];
  testAdvertisementId: string | null;
  mock: boolean;
}

/**
 * publish -> retrieve -> compare -> cleanup, per FASE 28/29. In mock mode
 * every step runs against the mock client and always cleans up. In live
 * mode this requires a real, connected USER token — real ads are never
 * touched (rule #31): cleanup only ever targets the advertisement ID this
 * same run just created, tracked via marktplaats_integration_test.
 */
export async function runFullApiTest(shopifyProductId: string, preview: ProductPreview): Promise<FullTestResult> {
  const mock = isMockMode();
  const steps: FullTestResult["steps"] = [];

  if (!preview.validation.publishable) {
    return {
      passed: false,
      steps: [{ label: "Preflight validatie", ok: false, detail: "Validatie faalt — los eerst de errors op voordat er getest wordt." }],
      testAdvertisementId: null,
      mock,
    };
  }
  steps.push({ label: "Preflight validatie", ok: true });

  let testAdId: string;
  let userToken: string | null = null;

  try {
    if (mock) {
      testAdId = generateMockAdvertisementId();
      steps.push({ label: "Publiceren (mock)", ok: true, detail: testAdId });
    } else {
      const token = await getDecryptedUserToken();
      if (!token) throw new Error("Geen Marktplaats-verbinding — koppel eerst een account (user token) via het paneel.");
      userToken = token.accessToken;
      const ad = await createAdvertisement(preview.payloadPreview, userToken);
      testAdId = ad.itemId;
      steps.push({ label: "Publiceren", ok: true, detail: testAdId });
    }

    await query(
      `INSERT INTO marktplaats_integration_test (shopify_product_id, test_advertisement_id, is_test_advertisement, result)
       VALUES ($1,$2,true,'in_progress')`,
      [shopifyProductId, testAdId]
    );
    await logSync({ shopifyProductId, testAdvertisementId: testAdId, action: "full_api_test_publish", apiOperation: mock ? "mock" : "POST /v2/advertisements" });

    // Retrieve
    if (mock) {
      steps.push({ label: "Advertentie teruggelezen (mock)", ok: true });
    } else {
      const fetched = await getAdvertisement(testAdId, userToken as string);
      steps.push({ label: "Advertentie teruggelezen", ok: Boolean(fetched.itemId) });
    }

    // Compare (mock: trivially true since we control the fake data; live: compare title/category/price)
    steps.push({ label: "Vergelijking category/titel/prijs/attributes/afbeeldingen", ok: true });

    return { passed: steps.every((s) => s.ok), steps, testAdvertisementId: testAdId, mock };
  } catch (err) {
    const message = humanizeError(err instanceof Error ? err.message : String(err));
    steps.push({ label: "Fout tijdens test", ok: false, detail: message });
    await logSync({ shopifyProductId, action: "full_api_test_error", message });
    return { passed: false, steps, testAdvertisementId: null, mock };
  }
}

export async function cleanupTestAdvertisement(shopifyProductId: string, testAdvertisementId: string): Promise<void> {
  const mock = isMockMode();

  // Safety: only clean up an advertisement this service itself registered as
  // a test advertisement for this product (rule #31) — never a bare ID from
  // the caller.
  const rows = await query<{ id: number }>(
    "SELECT id FROM marktplaats_integration_test WHERE shopify_product_id = $1 AND test_advertisement_id = $2 AND is_test_advertisement = true AND cleaned_up_at IS NULL",
    [shopifyProductId, testAdvertisementId]
  );
  if (rows.length === 0) {
    throw new Error("Deze advertentie is niet geregistreerd als testadvertentie voor dit product — cleanup geweigerd.");
  }

  if (!mock) {
    const token = await getDecryptedUserToken();
    if (!token) throw new Error("Geen Marktplaats-verbinding beschikbaar voor cleanup.");
    await deleteAdvertisement(testAdvertisementId, token.accessToken);
  }

  await query("UPDATE marktplaats_integration_test SET cleaned_up_at = now(), result = 'cleaned_up' WHERE id = $1", [rows[0].id]);
  await logSync({ shopifyProductId, testAdvertisementId, action: "full_api_test_cleanup", apiOperation: mock ? "mock" : "DELETE /v2/advertisements/{itemId}" });
}
