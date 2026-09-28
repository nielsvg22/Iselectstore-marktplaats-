/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
    // @napi-rs/canvas ships a native .node binary — must stay external to
    // webpack (which can't parse it) rather than bundled.
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
    // Ensures the bundled sticker font (read via fs in lib/soldImage/overlay.ts)
    // is actually included in the serverless function output — Next's
    // automatic file tracing can miss assets loaded relative to __dirname
    // once a route is bundled into a single file.
    outputFileTracingIncludes: {
      "/api/webhooks/products-update": ["./lib/soldImage/assets/**"],
      "/api/cron/daily": ["./lib/soldImage/assets/**"],
    },
  },
};

module.exports = nextConfig;
