import type { ProductPreview } from "../marktplaats/orchestrator";

/** TikTok's post_info.title for a photo post is capped at 90 characters. */
const TITLE_MAX_LENGTH = 90;

/**
 * Builds a short TikTok caption/title for a product photo post. Unlike
 * Instagram's caption (lib/instagram/captionBuilder.ts), TikTok's photo
 * post only has a single title field with a strict 90-character cap, so
 * this is deliberately terse: product title + price + a short call to
 * action, truncated to fit rather than the full fact list Instagram gets.
 */
export function buildTiktokCaption(preview: ProductPreview): string {
  const price = `€${preview.price.toFixed(2).replace(".", ",")}`;
  const base = `${preview.shopifyTitle} - ${price} - iSelectStore #apple #refurbished`;
  if (base.length <= TITLE_MAX_LENGTH) return base;

  const withoutHashtags = `${preview.shopifyTitle} - ${price} - iSelectStore`;
  if (withoutHashtags.length <= TITLE_MAX_LENGTH) return withoutHashtags;

  return withoutHashtags.slice(0, TITLE_MAX_LENGTH - 1) + "…";
}
