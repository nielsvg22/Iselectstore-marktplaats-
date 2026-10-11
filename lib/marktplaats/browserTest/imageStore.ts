import fs from "node:fs";
import path from "node:path";
import { ensureDir, getBrowserTestConfig } from "./config";

export interface DownloadedImage {
  url: string;
  filePath: string;
  fileName: string;
}

export interface ImageDownloadResult {
  dir: string;
  files: DownloadedImage[];
  failures: { url: string; error: string }[];
  skipped: string[];
}

function fileNameFor(url: string, index: number): string {
  let base = "product";
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    base = decodeURIComponent(last) || "product";
  } catch {
    /* keep default */
  }
  base = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!/\.(jpe?g|png|webp|gif)$/i.test(base)) base = `${base}.jpg`;
  return `${String(index + 1).padStart(2, "0")}_${base}`;
}

/**
 * Downloads the Shopify product images (the URLs we already map to
 * `imageUrls` in the central pipeline) to a local temp folder so Playwright
 * can pass real files to the Marktplaats file input. Shopify stays the source
 * of truth — nothing is stored permanently.
 */
/**
 * Bounded-concurrency map: runs `worker` over `items` with at most `limit` in
 * flight at once instead of either fully sequential (slow — each image
 * download used to wait for the previous one to finish) or fully parallel
 * (which could hammer the Shopify CDN with 10+ simultaneous requests for a
 * single product). No new dependency: a handful of self-advancing workers
 * pulling from a shared index is all `p-limit` does internally anyway.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const DOWNLOAD_CONCURRENCY = 4;

export async function downloadImagesForBrowserTest(imageUrls: string[], runId: string): Promise<ImageDownloadResult> {
  const config = getBrowserTestConfig();
  const dir = path.join(config.tempImageRoot, runId);
  ensureDir(dir);

  const urls = imageUrls.slice(0, config.maxImages);
  const skipped = imageUrls.slice(config.maxImages);

  // Parallel with bounded concurrency (part 5: speed) — sequential downloads
  // of 5-10 product photos used to add up to several seconds of pure network
  // wait before Playwright could even touch the file input. The filename
  // index must match download ORDER, not completion order, so the numeric
  // prefix stays stable regardless of which request finishes first.
  const outcomes = await mapWithConcurrency(urls, DOWNLOAD_CONCURRENCY, async (url, index) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error("leeg bestand");
      const fileName = fileNameFor(url, index);
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, buffer);
      return { ok: true as const, file: { url, filePath, fileName } };
    } catch (err) {
      return { ok: false as const, failure: { url, error: err instanceof Error ? err.message : String(err) } };
    }
  });

  const files: DownloadedImage[] = [];
  const failures: { url: string; error: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) files.push(outcome.file);
    else failures.push(outcome.failure);
  }

  return { dir, files, failures, skipped };
}

/**
 * Best effort cleanup of the temp folder. Never throws — a leftover temp file
 * must not break the test run, and the browser must stay open for manual
 * inspection either way.
 */
export async function cleanupImageDir(dir: string | null): Promise<void> {
  if (!dir) return;
  try {
    const config = getBrowserTestConfig();
    if (!path.resolve(dir).startsWith(path.resolve(config.tempImageRoot))) return;
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Removes temp folders left behind by earlier (crashed) runs. */
export function cleanupStaleImageDirs(): void {
  try {
    const config = getBrowserTestConfig();
    if (!fs.existsSync(config.tempImageRoot)) return;
    for (const entry of fs.readdirSync(config.tempImageRoot)) {
      fs.rmSync(path.join(config.tempImageRoot, entry), { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}
