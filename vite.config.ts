import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "test"
      ? []
      : [
          cloudflare({ configPath: process.env.BRISA_CONFIG ?? "wrangler.jsonc" }),
          VitePWA({
            strategies: "injectManifest",
            srcDir: "src/pwa",
            filename: "sw.ts",
            outDir: "dist/client",
            registerType: "prompt",
            injectRegister: null,
            includeAssets: [],
            injectManifest: { globPatterns: ["offline.html", "icon.svg", "icons/*.png"] },
            devOptions: { enabled: true, type: "module", navigateFallback: "offline.html" },
            manifest: {
              id: "/",
              name: "Brisa",
              short_name: "Brisa",
              description: "A quieter home for your notifications.",
              start_url: "/",
              scope: "/",
              display: "standalone",
              background_color: "#f4f5fa",
              theme_color: "#f4f5fa",
              icons: [
                { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                {
                  src: "/icons/maskable-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
              ],
            },
          }),
        ]),
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  fmt: { ignorePatterns: ["worker-configuration.d.ts", "pnpm-lock.yaml", "dist/**"] },
  lint: {
    ignorePatterns: ["worker-configuration.d.ts", "dist/**"],
    plugins: ["react", "typescript", "oxc"],
    rules: { "react/rules-of-hooks": "error" },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20000 },
}));
