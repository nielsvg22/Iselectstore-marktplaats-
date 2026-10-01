import { ProductPreview } from "./orchestrator";
import { publishToMarktplaats } from "./publishService";

/**
 * MarktplaatsApiPublisher — the FUTURE official API publication path.
 *
 * Thin, explicit wrapper around the existing publishService so the UI/route
 * layer talks to a publisher interface rather than to a free function, and so
 * there is exactly one place to swap in the real API when Marktplaats grants
 * API access.
 *
 * The local Playwright browser test (MarktplaatsBrowserTestPublisher) must
 * never be used as a substitute for this class.
 */
export interface ApiPublishResult {
  advertisementId: string;
  mock: boolean;
}

export class MarktplaatsApiPublisher {
  /**
   * Whether there is usable API configuration. Mock mode always counts as
   * configured (it performs no real call), so existing mock testing keeps
   * working; a real environment without credentials is reported as missing.
   */
  isConfigured(): boolean {
    const environment = process.env.MARKTPLAATS_ENVIRONMENT || "mock";
    if (environment === "mock") return true;
    return Boolean(process.env.MARKTPLAATS_CLIENT_ID && process.env.MARKTPLAATS_CLIENT_SECRET);
  }

  /** Real advertisement placement through the Marktplaats API. */
  async publish(shopifyProductId: string, preview: ProductPreview): Promise<ApiPublishResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "Geen Marktplaats API-configuratie gevonden (MARKTPLAATS_CLIENT_ID / MARKTPLAATS_CLIENT_SECRET)."
      );
    }
    return publishToMarktplaats(shopifyProductId, preview);
  }
}

export const marktplaatsApiPublisher = new MarktplaatsApiPublisher();
