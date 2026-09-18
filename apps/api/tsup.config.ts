import { defineConfig, type Options } from "tsup";

/** tsup config (spec deploy §2). Bundles the @expense-app/shared workspace
 * source directly into the server bundle so the production runtime never has
 * to resolve `.ts` imports from packages/shared. */
export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  outDir: "dist",
  target: "node20",
  noExternal: ["@expense-app/shared"],
} satisfies Options);
