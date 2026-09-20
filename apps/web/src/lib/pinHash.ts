import { IS_TAURI } from "./tauri";

/**
 * Call the Rust `hash_pin` command (scrypt, see src-tauri/src/lib.rs).
 *
 * Hashing happens natively so the gate does not depend on WebCrypto being in
 * a secure context inside the WebView. Dynamic import keeps the browser
 * bundle free of @tauri-apps/api; this is only ever called in Tauri.
 */
export async function invokePinHash(pin: string, salt: string): Promise<string> {
  if (!IS_TAURI) {
    throw new Error("hash_pin is only available in the Tauri runtime");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("hash_pin", { pin, salt });
}

/** 16-byte random salt, hex-encoded (WebCrypto is available for randomness). */
export function newSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
