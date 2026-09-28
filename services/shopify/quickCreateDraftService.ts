// Bridges the Shopify Admin Action extension (a modal inside Shopify, can't
// run our AI-photo flow — no file upload component, limited sandbox) with the
// full-page AI recognition on /admin/quick-create, opened via the "Haal info
// op via AI-foto" link. The extension generates a draftId and passes it in
// that link; the Vercel page saves recognized fields + the uploaded photos
// against that draftId; the extension polls this table and pulls them back
// into the still-open Shopify form. Ephemeral — no user ever reads a draft
// they didn't create the id for, and rows are ignored once stale (2h).
import { query } from "@/lib/db";

export interface DraftImage {
  dataUrl: string;
  filename: string;
}

export interface QuickCreateDraft {
  draftId: string;
  productType: string;
  values: Record<string, string>;
  images: DraftImage[];
  updatedAt: string;
}

interface DraftRow {
  draft_id: string;
  product_type: string;
  values: Record<string, string>;
  images: DraftImage[];
  updated_at: string;
}

const STALE_AFTER_HOURS = 2;

export async function saveQuickCreateDraft(
  draftId: string,
  productType: string,
  values: Record<string, string>,
  images: DraftImage[]
): Promise<void> {
  await query(
    `INSERT INTO quick_create_draft (draft_id, product_type, values, images, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (draft_id) DO UPDATE SET
       product_type = $2, values = $3, images = $4, updated_at = now()`,
    [draftId, productType, JSON.stringify(values), JSON.stringify(images)]
  );
}

export async function getQuickCreateDraft(draftId: string): Promise<QuickCreateDraft | null> {
  const rows = await query<DraftRow>(
    `SELECT draft_id, product_type, values, images, updated_at FROM quick_create_draft
     WHERE draft_id = $1 AND updated_at > now() - (interval '1 hour' * $2)`,
    [draftId, STALE_AFTER_HOURS]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    draftId: row.draft_id,
    productType: row.product_type,
    values: row.values,
    images: row.images,
    updatedAt: row.updated_at,
  };
}
