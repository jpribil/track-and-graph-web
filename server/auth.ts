import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "tng_session";
const SESSION_DAYS = 30;

export type CurrentUser = { id: string; email: string; isAdmin: boolean };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expected] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [sha256(rawToken), userId, expiresAt],
  );
  reply.setCookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production" && process.env.APP_ORIGIN?.startsWith("https://") === true,
    expires: expiresAt,
  });
}

export async function currentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  const result = await db.query<{
    id: string;
    email: string;
    is_admin: boolean;
  }>(
    `SELECT u.id, u.email, u.is_admin
     FROM sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [sha256(token)],
  );
  const user = result.rows[0];
  return user ? { id: user.id, email: user.email, isAdmin: user.is_admin } : null;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<CurrentUser | null> {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send({ error: "Your session has expired or is missing." });
    return null;
  }
  return user;
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function deleteSession(request: FastifyRequest): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}
