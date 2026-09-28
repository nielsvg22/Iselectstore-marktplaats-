import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  // JSX in tests en getransformeerde bestanden (extension-code) moet met de
  // Preact-runtime compileren; de root-tsconfig staat op "preserve" en dat
  // leverde klassieke React.createElement aan.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  test: {
    environment: "node",
  },
});
