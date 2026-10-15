import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "test"
      ? []
      : [cloudflare({ configPath: process.env.BRISA_CONFIG ?? "wrangler.jsonc" })]),
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  fmt: { ignorePatterns: ["worker-configuration.d.ts", "pnpm-lock.yaml", "dist/**"] },
  lint: {
    ignorePatterns: ["worker-configuration.d.ts", "dist/**", "public/sw.js"],
    plugins: ["react", "typescript", "oxc"],
    rules: { "react/rules-of-hooks": "error" },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20000 },
}));
