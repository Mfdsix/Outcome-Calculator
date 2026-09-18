import { z } from "zod";

/**
 * PIN identity auth (6 alphanumeric characters, case-insensitive → normalized
 * to uppercase). Kept in shared so the lock screen and the API validate
 * identically. The PIN *is* the identity: a never-seen PIN automatically
 * provisions a new user space after explicit confirmation.
 */
export const PIN_LENGTH = 6;

/** Backwards-compatible alias (legacy name). */
export const ACCESS_CODE_LENGTH = PIN_LENGTH;

export const pinSchema = z
  .string()
  .regex(/^[a-zA-Z0-9]{6}$/, "PIN must be 6 alphanumeric characters.");

/** Backwards-compatible alias. */
export const accessCodeSchema = pinSchema;

/** Login request body: { pin: "ABC123", confirm?: true }. */
export const loginRequestSchema = z.object({
  pin: pinSchema,
  /** Present only on the second attempt: create a new user for this PIN. */
  confirm: z.boolean().optional(),
});

export function normalizePin(pin: string): string {
  return pin.trim().toUpperCase();
}

/** Backwards-compatible alias. */
export const normalizeAccessCode = normalizePin;

/** Minimum client-side interval between token refresh visits (1 hour). */
export const TOKEN_REFRESH_MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Session TTL: 20 hours, enforced server-side at token issuance. */
export const SESSION_TTL_MS = 20 * 60 * 60 * 1000;

/** Discriminated login result (see apps/api/src/auth.ts). */
export type LoginOk = { status: "ok"; token: string; expiresInMs: number };
export type LoginNewPin = { status: "new_pin" };
export type LoginResult = LoginOk | LoginNewPin;
