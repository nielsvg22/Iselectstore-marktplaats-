import { query } from "../db";
import { SoldImageSettings } from "./types";

interface SettingsRow {
  mode: string;
  delay_hours: number;
  sticker_text: string;
  position: string;
  size_percent: number;
  opacity: string;
  band_color_hex: string;
  text_color_hex: string;
}

function fromRow(row: SettingsRow): SoldImageSettings {
  return {
    mode: row.mode as SoldImageSettings["mode"],
    delayHours: row.delay_hours,
    stickerText: row.sticker_text,
    position: row.position as SoldImageSettings["position"],
    sizePercent: row.size_percent,
    opacity: Number(row.opacity),
    bandColorHex: row.band_color_hex,
    textColorHex: row.text_color_hex,
  };
}

const DEFAULTS: SoldImageSettings = {
  mode: "auto",
  delayHours: 0,
  stickerText: "VERKOCHT",
  position: "center",
  sizePercent: 60,
  opacity: 0.85,
  bandColorHex: "#dc2626",
  textColorHex: "#ffffff",
};

export async function getSoldImageSettings(): Promise<SoldImageSettings> {
  const rows = await query<SettingsRow>(
    "SELECT mode, delay_hours, sticker_text, position, size_percent, opacity, band_color_hex, text_color_hex FROM sold_image_settings ORDER BY id ASC LIMIT 1"
  );
  return rows[0] ? fromRow(rows[0]) : DEFAULTS;
}

export async function updateSoldImageSettings(patch: Partial<SoldImageSettings>): Promise<SoldImageSettings> {
  const current = await getSoldImageSettings();
  const next = { ...current, ...patch };
  await query(
    `UPDATE sold_image_settings SET
       mode = $1, delay_hours = $2, sticker_text = $3, position = $4,
       size_percent = $5, opacity = $6, band_color_hex = $7, text_color_hex = $8,
       updated_at = now()
     WHERE id = (SELECT id FROM sold_image_settings ORDER BY id ASC LIMIT 1)`,
    [next.mode, next.delayHours, next.stickerText, next.position, next.sizePercent, next.opacity, next.bandColorHex, next.textColorHex]
  );
  return next;
}
