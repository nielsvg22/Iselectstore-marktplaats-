// High-level GoedGeplaatst operations used by the admin UI/API routes.
// Mock mode (no API key) is handled uniformly here: every function returns
// the same SHAPE of result in mock and live mode, with an explicit `mock`
// flag the UI must render clearly (never a real-looking "Verbonden" state —
// STAP 10).

import { query } from "../db";
import { getGoedgeplaatstConfig, isGoedgeplaatstMockMode, manufacturerConfigured } from "./config";
import { goedgeplaatstRequest, GoedgeplaatstApiError, GoedgeplaatstConfigError } from "./client";
import { getOutboundIp, OutboundIpResult } from "./outboundIp";
import {
  GoedgeplaatstAd,
  GoedgeplaatstAddImagesInput,
  GoedgeplaatstAddImagesResult,
  GoedgeplaatstCategoryAttributes,
  GoedgeplaatstCategoryGroup,
  GoedgeplaatstStatus,
  GoedgeplaatstUser,
} from "./types";
import { MOCK_CATEGORY_GROUPS, MOCK_USER, buildMockAd, buildMockStatus, generateMockAdId, getMockCategoryAttributes } from "./mock";
import { AdMappingResult, ManualAdInput, buildAdPayloadFromShopifyPreview, buildManualAdPayload } from "./mapper";
import { ProductPreview } from "../marktplaats/orchestrator";
import { logGoedgeplaatstSync } from "./logging";

export type ConnectionState = "verbonden" | "niet_verbonden" | "sleutel_ontbreekt" | "ip_niet_toegestaan" | "api_fout";

export interface ConnectionStatusResult {
  mock: boolean;
  environment: "sandbox" | "production";
  state: ConnectionState;
  message: string;
  userIdConfigured: boolean;
  apiKeyConfigured: boolean;
  manufacturerConfigured: boolean;
  outboundIp: OutboundIpResult;
  checkedAt: string;
}

function ipLikelyNotWhitelisted(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("ip") && (m.includes("whitelist") || m.includes("not allowed") || m.includes("niet toegestaan") || m.includes("forbidden") || m.includes("403"));
}

/**
 * Connection test — per STAP 4/STAP 3 uses a documented READ-ONLY endpoint
 * (GET /users/?useCache=0&page=1&itemsPerPage=1), never anything that could
 * create/modify/publish data.
 */
export async function testConnection(): Promise<ConnectionStatusResult> {
  const config = getGoedgeplaatstConfig();
  const outboundIp = await getOutboundIp();
  const checkedAt = new Date().toISOString();

  if (isGoedgeplaatstMockMode()) {
    return {
      mock: true,
      environment: config.environment,
      state: !config.apiKey ? "sleutel_ontbreekt" : "niet_verbonden",
      message: !config.apiKey
        ? "Geen API-sleutel ingesteld — dit is een GESIMULEERDE (mock) status, geen echte verbinding."
        : "GOEDGEPLAATST_USER_ID ontbreekt — dit is een GESIMULEERDE (mock) status, geen echte verbinding.",
      userIdConfigured: Boolean(config.userId),
      apiKeyConfigured: Boolean(config.apiKey),
      manufacturerConfigured: manufacturerConfigured(config.manufacturer),
      outboundIp,
      checkedAt,
    };
  }

  try {
    await goedgeplaatstRequest<GoedgeplaatstUser[]>("GET", "users/?useCache=0&page=1&itemsPerPage=1");
    await logGoedgeplaatstSync({ action: "connection_test", apiOperation: "GET /users/", result: "ok" });
    return {
      mock: false,
      environment: config.environment,
      state: "verbonden",
      message: `Echte, geverifieerde verbinding met GoedGeplaatst (${config.environment}).`,
      userIdConfigured: true,
      apiKeyConfigured: true,
      manufacturerConfigured: manufacturerConfigured(config.manufacturer),
      outboundIp,
      checkedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const httpStatus = err instanceof GoedgeplaatstApiError ? err.httpStatus : undefined;
    await logGoedgeplaatstSync({ action: "connection_test", apiOperation: "GET /users/", result: "error", httpStatus, message });

    const state: ConnectionState = httpStatus === 403 || ipLikelyNotWhitelisted(message) ? "ip_niet_toegestaan" : "api_fout";
    return {
      mock: false,
      environment: config.environment,
      state,
      message,
      userIdConfigured: Boolean(config.userId),
      apiKeyConfigured: Boolean(config.apiKey),
      manufacturerConfigured: manufacturerConfigured(config.manufacturer),
      outboundIp,
      checkedAt,
    };
  }
}

export interface CategoriesResult {
  mock: boolean;
  groups: GoedgeplaatstCategoryGroup[];
}

export async function listCategories(): Promise<CategoriesResult> {
  const config = getGoedgeplaatstConfig();
  if (isGoedgeplaatstMockMode()) {
    return { mock: true, groups: MOCK_CATEGORY_GROUPS };
  }
  const body: Record<string, unknown> = { locale: "nl_NL" };
  if (config.userId) body.userId = config.userId;
  const groups = await goedgeplaatstRequest<GoedgeplaatstCategoryGroup[]>("POST", "categories/", body);
  return { mock: false, groups };
}

export interface AttributesResult {
  mock: boolean;
  categoryAttributes: GoedgeplaatstCategoryAttributes;
}

export async function listAttributesForCategory(categoryId: number): Promise<AttributesResult> {
  const config = getGoedgeplaatstConfig();
  if (isGoedgeplaatstMockMode()) {
    return { mock: true, categoryAttributes: getMockCategoryAttributes(categoryId) };
  }
  const body: Record<string, unknown> = { categoryId: [categoryId], locale: "nl_NL" };
  if (config.userId) body.userId = config.userId;
  const data = await goedgeplaatstRequest<GoedgeplaatstCategoryAttributes[]>("POST", "attributes/", body);
  const categoryAttributes = data[0] ?? { categoryId, attributes: [] };
  return { mock: false, categoryAttributes };
}

export interface CreateConceptAdParams {
  linkKey: string;
  shopifyProductId: string | null;
  categoryId: number;
  manual?: ManualAdInput;
  preview?: ProductPreview;
}

export interface CreateConceptAdResult {
  mock: boolean;
  reused: boolean;
  adId: number;
  attributeStatuses: AdMappingResult["attributeStatuses"];
  missingMandatory: string[];
  imagesAdded: number;
}

async function getExistingLink(linkKey: string, environment: string) {
  const rows = await query<{ goedgeplaatst_ad_id: string | null; concept_status: string; mock: boolean }>(
    "SELECT goedgeplaatst_ad_id, concept_status, mock FROM goedgeplaatst_product_link WHERE link_key = $1 AND environment = $2",
    [linkKey, environment]
  );
  return rows[0] ?? null;
}

async function upsertLink(params: {
  linkKey: string;
  environment: string;
  shopifyProductId: string | null;
  adId: number;
  conceptStatus: string;
  mock: boolean;
  lastError?: string | null;
}) {
  await query(
    `INSERT INTO goedgeplaatst_product_link (link_key, environment, shopify_product_id, goedgeplaatst_ad_id, concept_status, mock, last_sync_at, last_error)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
     ON CONFLICT (link_key, environment) DO UPDATE SET
       shopify_product_id = EXCLUDED.shopify_product_id,
       goedgeplaatst_ad_id = EXCLUDED.goedgeplaatst_ad_id,
       concept_status = EXCLUDED.concept_status,
       mock = EXCLUDED.mock,
       last_sync_at = now(),
       last_error = EXCLUDED.last_error,
       updated_at = now()`,
    [params.linkKey, params.environment, params.shopifyProductId, String(params.adId), params.conceptStatus, params.mock, params.lastError ?? null]
  );
}

/**
 * Creates a GoedGeplaatst concept advertisement (POST /ads/, status=concept
 * ONLY — never anything else), optionally adds images (PUT /images/<adId>),
 * and stores the shopify-product ↔ goedgeplaatst-adId link.
 *
 * IDEMPOTENCY (STAP 9): `linkKey` is the single source of truth. For a
 * Shopify-linked ad it is `shopify:<productId>` (one row per product+
 * environment); for the standalone manual test form it is
 * `manual:<client-generated-uuid>` that the client only regenerates when the
 * user explicitly resets the form. If a link already has an adId, we return
 * the EXISTING ad instead of creating a new one — repeated clicks (double
 * submit, retried request) can never create duplicate advertisements.
 */
export async function createConceptAd(params: CreateConceptAdParams): Promise<CreateConceptAdResult> {
  const config = getGoedgeplaatstConfig();
  const mock = isGoedgeplaatstMockMode();

  const existing = await getExistingLink(params.linkKey, config.environment);
  if (existing?.goedgeplaatst_ad_id) {
    return {
      mock: existing.mock,
      reused: true,
      adId: Number(existing.goedgeplaatst_ad_id),
      attributeStatuses: [],
      missingMandatory: [],
      imagesAdded: 0,
    };
  }

  const { categoryAttributes } = await listAttributesForCategory(params.categoryId);
  const attrDefs = categoryAttributes.attributes.flatMap((a) => a.attributes);

  let mapping: AdMappingResult;
  let imageUrls: string[];

  if (params.preview) {
    mapping = buildAdPayloadFromShopifyPreview({
      preview: params.preview,
      userId: config.userId ?? 0,
      categoryId: params.categoryId,
      categoryAttributes: attrDefs,
      manufacturer: config.manufacturer,
    });
    imageUrls = params.preview.imageUrls;
  } else if (params.manual) {
    mapping = buildManualAdPayload({
      input: params.manual,
      userId: config.userId ?? 0,
      categoryId: params.categoryId,
      categoryAttributes: attrDefs,
      manufacturer: config.manufacturer,
    });
    imageUrls = params.manual.imageUrls;
  } else {
    throw new Error("createConceptAd: geef `preview` (Shopify) of `manual` (testformulier) door.");
  }

  if (mapping.missingMandatory.length > 0) {
    throw new GoedgeplaatstConfigError(
      `Verplichte kenmerken ontbreken voor deze categorie: ${mapping.missingMandatory.join(", ")}. Vul de fabrikantgegevens (GOEDGEPLAATST_MANUFACTURER_*) in of kies een andere categorie.`
    );
  }

  let adId: number;
  if (mock) {
    adId = generateMockAdId();
  } else {
    try {
      const ad = await goedgeplaatstRequest<GoedgeplaatstAd>("POST", "ads/", mapping.payload);
      adId = ad.adId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await upsertLink({
        linkKey: params.linkKey,
        environment: config.environment,
        shopifyProductId: params.shopifyProductId,
        adId: 0,
        conceptStatus: "error",
        mock: false,
        lastError: message,
      });
      await logGoedgeplaatstSync({ linkKey: params.linkKey, shopifyProductId: params.shopifyProductId ?? undefined, action: "create_concept_ad", apiOperation: "POST /ads/", result: "error", message });
      throw err;
    }
  }

  let imagesAdded = 0;
  if (imageUrls.length > 0) {
    if (mock) {
      imagesAdded = imageUrls.length;
    } else {
      try {
        const body: GoedgeplaatstAddImagesInput = { images: imageUrls.map((url, i) => ({ counter: i, image: { url } })) };
        // PUT /images/<adId> ADDS images without replacing — see config.ts
        // header comment for why this (not POST /images/) is the right call.
        const result = await goedgeplaatstRequest<GoedgeplaatstAddImagesResult>("PUT", `images/${adId}`, body);
        imagesAdded = result.images?.length ?? 0;
      } catch (err) {
        // Images failing to attach must not roll back an already-created
        // concept ad — it exists; we just report fewer images than requested.
        await logGoedgeplaatstSync({
          linkKey: params.linkKey,
          shopifyProductId: params.shopifyProductId ?? undefined,
          goedgeplaatstAdId: adId,
          action: "add_images",
          apiOperation: `PUT /images/${adId}`,
          result: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await upsertLink({
    linkKey: params.linkKey,
    environment: config.environment,
    shopifyProductId: params.shopifyProductId,
    adId,
    conceptStatus: "concept",
    mock,
  });
  await logGoedgeplaatstSync({
    linkKey: params.linkKey,
    shopifyProductId: params.shopifyProductId ?? undefined,
    goedgeplaatstAdId: adId,
    action: "create_concept_ad",
    apiOperation: mock ? "mock" : "POST /ads/",
    result: mock ? "mock" : "ok",
  });

  return { mock, reused: false, adId, attributeStatuses: mapping.attributeStatuses, missingMandatory: mapping.missingMandatory, imagesAdded };
}

export interface VerifyAdResult {
  mock: boolean;
  found: boolean;
  ad: GoedgeplaatstAd | null;
  status: GoedgeplaatstStatus | null;
  /**
   * STAP 7: explicit distinction — never conflate "saved" with "published".
   * We never call publish, so onMarktplaats is always false in this version,
   * but it is still computed from the real GET /status/ response shape so
   * the field is meaningful the moment a future (out-of-scope) publish step
   * might exist.
   */
  savedInEnvironment: "sandbox" | "production";
  visibleInCustomerPortal: boolean;
  onMarktplaats: boolean;
  message: string;
}

/**
 * Verifies a previously created concept ad via GET /ads/ (never trusts the
 * create response alone — STAP 7 requires a fresh GET to prove it actually
 * landed) plus GET /status/<userId>/<adId> for the publish-state fields.
 */
export async function verifyAd(linkKey: string): Promise<VerifyAdResult> {
  const config = getGoedgeplaatstConfig();
  const rows = await query<{ goedgeplaatst_ad_id: string | null; mock: boolean }>(
    "SELECT goedgeplaatst_ad_id, mock FROM goedgeplaatst_product_link WHERE link_key = $1 AND environment = $2",
    [linkKey, config.environment]
  );
  const row = rows[0];
  if (!row?.goedgeplaatst_ad_id) {
    return {
      mock: isGoedgeplaatstMockMode(),
      found: false,
      ad: null,
      status: null,
      savedInEnvironment: config.environment,
      visibleInCustomerPortal: false,
      onMarktplaats: false,
      message: "Geen GoedGeplaatst-advertentie gevonden voor deze koppeling — maak er eerst een aan.",
    };
  }

  const adId = Number(row.goedgeplaatst_ad_id);

  if (row.mock) {
    const ad = buildMockAd({ adId, title: "(mock)", description: "(mock)", categoryId: 0, imageUrls: [] });
    return {
      mock: true,
      found: true,
      ad,
      status: buildMockStatus(adId, config.userId ?? 0),
      savedInEnvironment: config.environment,
      visibleInCustomerPortal: false,
      onMarktplaats: false,
      message: "GESIMULEERD (mock) resultaat — geen echte GoedGeplaatst-aanroep.",
    };
  }

  try {
    const ads = await goedgeplaatstRequest<GoedgeplaatstAd[]>("GET", `ads/?adId=${adId}`);
    const ad = ads.find((a) => a.adId === adId) ?? null;
    if (!ad) {
      return {
        mock: false,
        found: false,
        ad: null,
        status: null,
        savedInEnvironment: config.environment,
        visibleInCustomerPortal: false,
        onMarktplaats: false,
        message: `GET /ads/ gaf de advertentie (adId ${adId}) niet terug — nog niet (zeker) opgeslagen in GoedGeplaatst.`,
      };
    }

    let status: GoedgeplaatstStatus | null = null;
    try {
      status = await goedgeplaatstRequest<GoedgeplaatstStatus>("GET", `status/${config.userId}/${adId}`);
    } catch {
      // Status endpoint failing does not invalidate the GET /ads/ confirmation above.
    }

    const onlineOnAnyPortal = Boolean(status?.portals?.some((p) => p.publish?.online));
    await logGoedgeplaatstSync({ linkKey, goedgeplaatstAdId: adId, action: "verify_ad", apiOperation: "GET /ads/", result: "ok" });

    return {
      mock: false,
      found: true,
      ad,
      status,
      savedInEnvironment: config.environment,
      // A sandbox ad does not need to be visible in the regular customer
      // portal (per STAP 7); we only report "visible" when we are in
      // production AND the ad actually came back.
      visibleInCustomerPortal: config.environment === "production",
      onMarktplaats: onlineOnAnyPortal, // always false in this version — we never publish.
      message:
        ad.status === "concept"
          ? `Advertentie succesvol opgeslagen in GoedGeplaatst als concept (${config.environment}).`
          : `Advertentie gevonden, maar status is "${ad.status}" (verwacht: concept).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logGoedgeplaatstSync({ linkKey, goedgeplaatstAdId: adId, action: "verify_ad", apiOperation: "GET /ads/", result: "error", message });
    return {
      mock: false,
      found: false,
      ad: null,
      status: null,
      savedInEnvironment: config.environment,
      visibleInCustomerPortal: false,
      onMarktplaats: false,
      message,
    };
  }
}

export interface ListConceptsResult {
  mock: boolean;
  ads: GoedgeplaatstAd[];
}

export async function listConceptAds(): Promise<ListConceptsResult> {
  const config = getGoedgeplaatstConfig();
  if (isGoedgeplaatstMockMode()) {
    return { mock: true, ads: [] };
  }
  const query_ = config.userId ? `ads/?userId=${config.userId}&status=concept` : "ads/?status=concept";
  const ads = await goedgeplaatstRequest<GoedgeplaatstAd[]>("GET", query_);
  return { mock: false, ads };
}

export async function getLinkForShopifyProduct(shopifyProductId: string) {
  const config = getGoedgeplaatstConfig();
  const rows = await query<{ link_key: string; goedgeplaatst_ad_id: string | null; concept_status: string; mock: boolean; last_sync_at: string | null; last_error: string | null }>(
    "SELECT link_key, goedgeplaatst_ad_id, concept_status, mock, last_sync_at, last_error FROM goedgeplaatst_product_link WHERE shopify_product_id = $1 AND environment = $2",
    [shopifyProductId, config.environment]
  );
  return rows[0] ?? null;
}

export { MOCK_USER };
