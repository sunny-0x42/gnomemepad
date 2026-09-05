import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Point at Netlify Dev or a local API that uses chain-api
      // Example: netlify dev on :8888, or `node web/server-api.mjs` on :8787
      "/api": {
        target: process.env.API_PROXY || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
