import { execSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase E — guard rails for the per-runtime API base URL (plan A2):
 *
 * - Tauri build (`--mode tauri`) must inline VITE_API_URL from .env.tauri
 *   into the JS bundle: the webview has no origin to proxy from.
 * - PWA build (default mode) must stay same-origin ("" base) so requests
 *   hit the dev proxy / reverse proxy — and must keep emitting its service
 *   worker, which the Tauri build must NOT.
 *
 * These run a real vite build per mode (a few seconds each); slow but they
 * catch the exact failure mode that silently breaks the native app. The
 * spawned build gets a minimal env: inherited vitest/VITE_* variables would
 * leak into loadEnv() and change what import.meta.env inlines.
 */

const webRoot = join(__dirname, "..", "..");

function build(mode?: string): { js: string; hasSw: boolean } {
  const outDir = mkdtempSync(join(tmpdir(), "expense-build-"));
  const args = mode ? ["--mode", mode, "--outDir", outDir] : ["--outDir", outDir];
  execSync(`npx vite build ${args.join(" ")}`, {
    cwd: webRoot,
    stdio: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
  });
  const assets = execSync(`ls ${join(outDir, "assets")}`, { encoding: "utf8" });
  const jsFile = assets
    .split("\n")
    .find((name) => name.endsWith(".js"))
    ?.trim();
  const js = readFileSync(join(outDir, "assets", jsFile!), "utf8");
  const hasSw = execSync(`ls ${outDir}`, { encoding: "utf8" })
    .split("\n")
    .some((name) => name.trim() === "sw.js");
  rmSync(outDir, { recursive: true, force: true });
  return { js, hasSw };
}

describe("per-runtime API base URL (build-level)", () => {
  it(
    "tauri mode inlines the LAN API URL and ships no service worker",
    () => {
      const { js, hasSw } = build("tauri");
      expect(js).toContain("http://192.168.1.x:3000");
      expect(hasSw).toBe(false);
    },
    120_000,
  );

  it(
    "browser mode stays same-origin and keeps the PWA service worker",
    () => {
      const { js, hasSw } = build();
      expect(js).not.toContain("http://192.168.1.x:3000");
      expect(hasSw).toBe(true);
    },
    120_000,
  );
});
