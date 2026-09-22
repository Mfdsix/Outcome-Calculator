import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `--mode tauri` (npm run tauri:dev / tauri:build) builds for the native
 * shell: the PWA plugin is disabled there because assets ship inside the
 * app binary — a service worker would be useless (UpdateBanner already
 * no-ops at runtime via IS_TAURI). It also loads `.env.tauri` for
 * VITE_API_URL. The browser/PWA build keeps the default mode.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: injectRegister "auto" keeps dev/tests untouched; registerSW is
    // injected into the entry at build time and main.tsx consumes it.
    ...(mode === "tauri"
      ? []
      : [
          VitePWA({
            injectRegister: "auto",
            registerType: "prompt",
            includeAssets: ["favicon.svg", "apple-touch-icon.png"],
            manifest: {
              name: "Pengeluaran — Kalkulator Harian",
              short_name: "Pengeluaran",
              description:
                "Catat pengeluaran harian sekencang kalkulator. Bisa dipakai offline untuk hari ini.",
              id: "/",
              start_url: "/",
              scope: "/",
              display: "standalone",
              orientation: "portrait",
              background_color: "#0a0a0a",
              theme_color: "#0a0a0a",
              icons: [
                { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
                {
                  src: "/icons/pwa-512.png",
                  sizes: "512x512",
                  type: "image/png",
                },
                {
                  src: "/icons/pwa-maskable-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
              navigateFallback: "/index.html",
              navigateFallbackDenylist: [/^\/api\//, /^\/sw\.js$/, /^\/manifest\.webmanifest$/],
            },
            devOptions: { enabled: false },
          }),
        ]),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
}));
