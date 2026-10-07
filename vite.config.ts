import { defineConfig } from "vite";

// The deploy base path (e.g. "/nyc-enclave-finder/" for GitHub Pages project sites)
// comes from the environment so no repo name is hard-coded.
export default defineConfig({
  root: "web",
  base: process.env.VITE_BASE ?? "/",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    root: ".",
    include: ["web/src/**/*.test.ts"],
    environment: "node",
  },
} as never);
