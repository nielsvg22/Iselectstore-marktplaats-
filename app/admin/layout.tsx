import Script from "next/script";

export const metadata = {
  other: {
    "shopify-api-key": "db247c0b3b7c65f9b5d8d798ae30b925",
  },
};

// App Bridge's actual working mechanism for sidebar nav registration —
// picked up by app-bridge.js and moved into Shopify's real sidebar, never
// rendered visibly itself. (The newer <s-app-nav>/<s-link> web components
// rendered as plain unstyled inline text instead of being recognized —
// swapped out for this.) Not part of React's JSX.IntrinsicElements — cast
// rather than add a global .d.ts, since this is the only place it's used.
const UiNavMenu = "ui-nav-menu" as unknown as React.FC<React.PropsWithChildren<Record<string, unknown>>>;

/**
 * Registers this app's own entries in the Shopify Admin sidebar (nested
 * under its own row in the "Apps" section — Shopify does not allow apps to
 * add top-level sections like Producten/Klanten). Only takes effect when the
 * app is actually loaded embedded inside /admin/apps/... — opening these
 * routes directly (e.g. straight to this domain, outside Shopify) simply
 * renders the page without a nav, app-bridge.js no-ops outside an iframe.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" strategy="afterInteractive" />
      <UiNavMenu>
        <a href="/admin" rel="home">Marktplaats</a>
        <a href="/admin/inventory">Voorraadmeldingen</a>
        <a href="/admin/inkoopverklaringen">Inkoopverklaringen</a>
        <a href="/admin/quick-create">Nieuw product</a>
        <a href="/admin/goedgeplaatst">GoedGeplaatst</a>
        <a href="/admin/lifecycle">28-dagen cleanup</a>
      </UiNavMenu>
      {children}
    </>
  );
}
