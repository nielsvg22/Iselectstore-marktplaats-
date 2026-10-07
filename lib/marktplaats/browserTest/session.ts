import type { BrowserContext } from "playwright";

/**
 * Keeps ONE persistent Playwright context alive across runs so the browser
 * (and the Marktplaats login inside it) stays open for manual inspection and
 * is shared by every concurrent run — each run gets its own tab inside this
 * same context (see browserTestPublisher.ts's resolvePage()), so several
 * products can be tested in parallel without a separate login each.
 * Stored on globalThis to survive Next.js dev hot-reloads.
 */
interface SessionHolder {
  context: BrowserContext | null;
}

function holder(): SessionHolder {
  const g = globalThis as typeof globalThis & { __marktplaatsBrowserSession?: SessionHolder };
  if (!g.__marktplaatsBrowserSession) g.__marktplaatsBrowserSession = { context: null };
  return g.__marktplaatsBrowserSession;
}

export function getActiveContext(): BrowserContext | null {
  const context = holder().context;
  if (!context) return null;
  try {
    context.pages();
    return context;
  } catch {
    holder().context = null;
    return null;
  }
}

export function setActiveContext(context: BrowserContext | null): void {
  holder().context = context;
}
