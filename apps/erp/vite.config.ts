import path from "node:path";
import { defineConfig } from "vite";

// The ERP is served under /erp/ next to Plane (same origin => Plane's session cookie is shared).
const API_TARGET = process.env.ERP_API_TARGET || "http://localhost:8000";

export default defineConfig({
  base: "/erp/",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  oxc: { jsx: { runtime: "automatic" } },
  server: {
    port: 3010,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/auth": { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: { port: 3010 },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: "happy-dom" },
} as any);
