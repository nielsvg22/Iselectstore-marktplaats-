/** @type {import('next').NextConfig} */
const nextConfig = {
  // Without this, the browser refuses to let Shopify Admin iframe /admin/**
  // (no explicit frame-ancestors = treated as deny by modern browsers once
  // X-Frame-Options or CSP is expected), so every click "breaks out" of the
  // embedded admin into a bare top-level tab on this Vercel domain instead
  // of staying inside Shopify — this is what makes that happen.
  async headers() {
    return [
      {
        source: "/admin/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
          },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
    // @napi-rs/canvas ships a native .node binary — must stay external to
    // webpack (which can't parse it) rather than bundled. playwright is kept
    // external too: it ships browser binaries and must only ever load
    // server-side (lib/marktplaats/browserTest/*), never in a client bundle.
    serverComponentsExternalPackages: ["@napi-rs/canvas", "playwright", "playwright-core"],
    // Ensures the bundled sticker font (read via fs in lib/soldImage/overlay.ts)
    // is actually included in the serverless function output — Next's
    // automatic file tracing can miss assets loaded relative to __dirname
    // once a route is bundled into a single file.
    outputFileTracingIncludes: {
      "/api/webhooks/products-update": ["./lib/soldImage/assets/**", "./lib/watermark/assets/**"],
      "/api/webhooks/products-create": ["./lib/watermark/assets/**"],
      "/api/cron/daily": ["./lib/soldImage/assets/**"],
    },
  },
};

module.exports = nextConfig;
