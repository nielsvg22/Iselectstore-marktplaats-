// Downloads Shopify CDN image URLs to a throwaway local temp dir so
// Playwright's setInputFiles() can upload them (it needs real files, not
// URLs). Always clean up afterwards, even on error.

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export interface DownloadedImage {
  url: string;
  path: string;
}

function extensionFor(url: string): string {
  const match = /\.(jpe?g|png|webp|gif)(\?|$)/i.exec(url);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

/** Downloads every image URL into a fresh temp dir; returns the dir + per-file results (failures are reported, not thrown). */
export async function downloadImages(urls: string[]): Promise<{ dir: string; images: DownloadedImage[]; failed: { url: string; error: string }[] }> {
  const dir = await mkdtemp(join(tmpdir(), "mkt-browser-test-"));
  const images: DownloadedImage[] = [];
  const failed: { url: string; error: string }[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const path = join(dir, `image-${i + 1}${extensionFor(url)}`);
      await writeFile(path, buffer);
      images.push({ url, path });
    } catch (err) {
      failed.push({ url, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { dir, images, failed };
}

export async function cleanupImages(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
