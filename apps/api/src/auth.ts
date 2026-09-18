import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { SESSION_TTL_MS, loginRequestSchema, normalizePin } from "@expense-app/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { loadEnv } from "./env.js";
import { prisma } from "./prisma.js";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const TOKEN_HMAC_CONTEXT = "expense-app:token-hmac-context:v2";
const PIN_LOOKUP_CONTEXT = "pin-lookup";

/**
 * Derive the token signing key: APP_JWT_SECRET mixed with a constant
 * app-specific context. Rotating the secret invalidates all tokens.
 */
function getSigningKey(secret: string): string {
  return createHmac("sha256", secret).update(TOKEN_HMAC_CONTEXT).digest("hex");
}

/** pinLookup = HMAC(secret, "pin-lookup" || pin) — indexed, unique, reversible to nobody. */
export function pinLookup(secret: string, pin: string): string {
  return createHmac("sha256", secret).update(`${PIN_LOOKUP_CONTEXT}\u0000${pin}`).digest("hex");
}

/** Hash a PIN for verification: scrypt with a per-user random salt. */
async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verify a PIN against a stored scrypt hash (constant-time). */
async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const derived = await scrypt(pin, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) {
    timingSafeEqual(derived, derived);
    return false;
  }
  return timingSafeEqual(derived, expected);
}

/** Constant-time string comparison (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export interface TokenPayload {
  /** Token type marker. */
  t: "access";
  /** Subject: the user id (uuid) this token belongs to. */
  sub: string;
  /** Issued-at epoch ms. */
  iat: number;
  /** Expiry epoch ms. */
  exp: number;
}

export function createToken(secret: string, userId: string, ttlMs = SESSION_TTL_MS): string {
  const payload: TokenPayload = {
    t: "access",
    sub: userId,
    iat: Date.now(),
    exp: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getSigningKey(secret))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: string };

export function verifyToken(token: string, secret: string): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = createHmac("sha256", getSigningKey(secret))
    .update(body)
    .digest("base64url");
  if (!safeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (payload.t !== "access" || typeof payload.sub !== "string" || payload.sub.length === 0) {
      return { ok: false, reason: "malformed" };
    }
    if (typeof payload.exp !== "number") return { ok: false, reason: "malformed" };
    if (Date.now() >= payload.exp) return { ok: false, reason: "expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** 20 hours — session window per plan (locked). */
export const TOKEN_TTL_MS = SESSION_TTL_MS;

export function bearerFromRequest(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

// ---------------------------------------------------------------------------
// Login rate limiting (in-memory, per IP; reset on restart = acceptable).
// Wajib karena ruang PIN hanya 6 karakter — brute force harus dibatasi.
// ---------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

interface LoginBucket {
  count: number;
  windowStart: number;
}

const loginBuckets = new Map<string, LoginBucket>();

export function loginRateLimit(
  ip: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const bucket = loginBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= LOGIN_WINDOW_MS) {
    loginBuckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > LOGIN_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - bucket.windowStart)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Provision a new user for a PIN. Caller has already validated the PIN format. */
async function provisionUser(secret: string, pin: string) {
  const pinHash = await hashPin(pin);
  return prisma.user.create({ data: { pinLookup: pinLookup(secret, pin), pinHash } });
}

export function registerAuth(app: FastifyInstance, jwtSecret: string): void {
  /**
   * Every /api/* route requires a valid bearer token, except login.
   * This includes refresh: a refresh call IS an authenticated call — the
   * verification below attaches request.userId which the refresh handler
   * reuses. On success the request is annotated with request.userId.
   */
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.method === "POST" && request.url.startsWith("/api/auth/login")) return;

    const token = bearerFromRequest(request);
    if (!token) {
      return reply.status(401).send({ error: "Unauthorized." });
    }
    const verified = verifyToken(token, jwtSecret);
    if (!verified.ok) {
      return reply.status(401).send({ error: "Unauthorized." });
    }

    // The subject must be a real user (token was signed by us, but the user
    // could have been deleted since).
    const user = await prisma.user.findUnique({ where: { id: verified.payload.sub } });
    if (!user) return reply.status(401).send({ error: "Unauthorized." });

    request.userId = user.id;
  });

  app.post("/api/auth/login", async (request, reply) => {
    const rate = loginRateLimit(request.ip);
    if (!rate.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(rate.retryAfterSeconds))
        .send({ error: "Terlalu banyak percobaan. Coba lagi nanti." });
    }

    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "PIN must be 6 alphanumeric characters." });
    }

    const pin = normalizePin(parsed.data.pin);
    const user = await prisma.user.findUnique({ where: { pinLookup: pinLookup(jwtSecret, pin) } });

    if (!user) {
      // Unknown PIN: never create an identity on a typo. Require an explicit
      // second request with confirm:true.
      if (!parsed.data.confirm) {
        return reply.status(202).send({ needsConfirm: true });
      }
      try {
        const created = await provisionUser(jwtSecret, pin);
        const token = createToken(jwtSecret, created.id);
        return reply.send({ token, expiresInMs: TOKEN_TTL_MS });
      } catch (error) {
        // Double-provision race: unique violation on pin_lookup — the other
        // request won; read back and verify instead of failing.
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          const winner = await prisma.user.findUnique({
            where: { pinLookup: pinLookup(jwtSecret, pin) },
          });
          if (winner && (await verifyPin(pin, winner.pinHash))) {
            const token = createToken(jwtSecret, winner.id);
            return reply.send({ token, expiresInMs: TOKEN_TTL_MS });
          }
        }
        throw error;
      }
    }

    if (!(await verifyPin(pin, user.pinHash))) {
      return reply.status(401).send({ error: "PIN salah." });
    }

    const token = createToken(jwtSecret, user.id);
    return reply.send({ token, expiresInMs: TOKEN_TTL_MS });
  });

  /**
   * Refresh: no new auth logic. The preHandler above already rejected
   * anything without a valid Bearer token and attached request.userId, so
   * the handler just mints a fresh 20h token. Non-rotating: old tokens stay
   * alive until their own exp (stateless server, no revocation store).
   */
  app.post("/api/auth/refresh", async (request, reply) => {
    const userId = request.userId as string;
    const token = createToken(jwtSecret, userId);
    return reply.send({ token, expiresInMs: TOKEN_TTL_MS });
  });
}

// Module augmentation so request.userId is typed across the API.
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}
