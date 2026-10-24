import Script from "next/script";

export const metadata = {
  other: {
    "shopify-api-key": "db247c0b3b7c65f9b5d8d798ae30b925",
  },
};

// Shopify's App Bridge web components (<s-app-nav>/<s-link>) aren't part of
// React's JSX.IntrinsicElements — cast rather than add a global .d.ts, since
// this is the only place they're used.
const SAppNav = "s-app-nav" as unknown as React.FC<React.PropsWithChildren<Record<string, unknown>>>;
const SLink = "s-link" as unknown as React.FC<React.PropsWithChildren<{ href: string; rel?: string }>>;

/**
 * Registers this app's own entries in the Shopify Admin sidebar (nested
 * under its own row in the "Apps" section — Shopify does not allow apps to
 * add top-level sections like Producten/Klanten). Only takes effect when the
 * app is actually loaded embedded inside /admin/apps/... — opening these
 * routes directly (e.g. this Vercel URL outside Shopify) simply renders the
 * page without a nav, app-bridge.js no-ops outside an iframe.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" strategy="afterInteractive" />
      <SAppNav>
        <SLink href="/admin" rel="home">Marktplaats</SLink>
        <SLink href="/admin/inventory">Voorraadmeldingen</SLink>
        <SLink href="/admin/inkoopverklaringen">Inkoopverklaringen</SLink>
        <SLink href="/admin/quick-create">Nieuw product</SLink>
        <SLink href="/admin/goedgeplaatst">GoedGeplaatst</SLink>
        <SLink href="/admin/lifecycle">28-dagen cleanup</SLink>
      </SAppNav>
      {children}
    </>
  );
}
