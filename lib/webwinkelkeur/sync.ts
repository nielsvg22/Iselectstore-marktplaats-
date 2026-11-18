// Keeps the "X,X/10 · N reviews" text that appears across the theme
// (homepage hero, "Hoe wij werken"-sectie, productpagina's) in sync with
// WebwinkelKeur's actual numbers, instead of a hardcoded value that goes
// stale the moment a new review comes in. Called once a day from the
// existing cron (app/api/cron/daily/route.ts) — WebwinkelKeur's own ratings
// don't change fast enough to need anything more frequent, and this keeps
// the private API key server-side only, never exposed to the storefront.
import { setShopMetafield } from "../shopify/client";
import { logSync } from "../logging";

interface WebwinkelKeurSummary {
  status: string;
  message: string;
  data?: {
    amount: number;
    rating_average: number;
  };
}

export async function syncWebwinkelKeurRating(): Promise<{ ok: boolean; amount?: number; rating?: number }> {
  const shopId = process.env.WEBWINKELKEUR_SHOP_ID;
  const apiKey = process.env.WEBWINKELKEUR_API_KEY;
  if (!shopId || !apiKey) {
    await logSync({ action: "webwinkelkeur_sync_error", message: "WEBWINKELKEUR_SHOP_ID / WEBWINKELKEUR_API_KEY ontbreken." }).catch(() => {});
    return { ok: false };
  }

  try {
    const res = await fetch(`https://dashboard.webwinkelkeur.nl/api/1.0/ratings_summary.json?id=${encodeURIComponent(shopId)}&code=${encodeURIComponent(apiKey)}`);
    const json = (await res.json()) as WebwinkelKeurSummary;
    if (!res.ok || json.status !== "success" || !json.data) {
      throw new Error(`WebwinkelKeur API-fout: ${JSON.stringify(json)}`);
    }

    // Already on a 1-10 scale for this account (confirmed live — 9.82 for
    // 650 reviews), not the 1-5 scale WebwinkelKeur's own docs describe
    // elsewhere, so no conversion here. Rounded to 1 decimal, Dutch comma,
    // to match the site's existing "9,8/10" formatting exactly.
    const ratingRounded = Math.round(json.data.rating_average * 10) / 10;
    const ratingDutch = ratingRounded.toFixed(1).replace(".", ",");

    await setShopMetafield("custom", "rating_average", ratingDutch, "single_line_text_field");
    await setShopMetafield("custom", "review_count", String(json.data.amount), "number_integer");

    await logSync({ action: "webwinkelkeur_sync", message: `rating=${ratingDutch}/10, reviews=${json.data.amount}` });
    return { ok: true, amount: json.data.amount, rating: ratingRounded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync({ action: "webwinkelkeur_sync_error", message }).catch(() => {});
    return { ok: false };
  }
}
