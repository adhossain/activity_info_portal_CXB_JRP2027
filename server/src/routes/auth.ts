import type { FastifyInstance } from "fastify";
import { ai, ActivityInfoError } from "../activityinfo-client.js";
import {
  sessionStore,
  generateSessionId,
  encryptToken,
  decryptToken,
} from "../session.js";
import { clearSessionCache } from "../schema-cache.js";
import { config } from "../config.js";
import { recordLogin } from "../login-log.js";

const COOKIE_NAME = "sid";
const MAX_AGE = 24 * 60 * 60; // 1 day in seconds

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; token: string } }>(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, token } = req.body ?? {};
      if (!email || !token) {
        return reply.status(400).send({ error: "Email and token are required" });
      }

      try {
        await ai.getDatabases(token);
      } catch (err) {
        if (err instanceof ActivityInfoError && err.status === 401) {
          return reply.status(401).send({ error: "Invalid credentials" });
        }
        throw err;
      }

      recordLogin(email).catch((err) => req.log.warn({ err }, "could not record login"));

      const sid = generateSessionId();
      sessionStore.set(sid, {
        email,
        token: encryptToken(token, config.sessionSecret),
        createdAt: Date.now(),
      });

      reply.setCookie(COOKIE_NAME, sid, {
        httpOnly: true,
        secure: req.protocol === "https",
        sameSite: "lax",
        path: "/",
        maxAge: MAX_AGE,
      });

      return { ok: true, email };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[COOKIE_NAME];
    if (sid) {
      clearSessionCache(sid);
      sessionStore.delete(sid);
      reply.clearCookie(COOKIE_NAME, { path: "/" });
    }
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const sid = req.cookies[COOKIE_NAME];
    if (!sid) return reply.status(401).send({ error: "Not authenticated" });

    const session = sessionStore.get(sid);
    if (!session) {
      reply.clearCookie(COOKIE_NAME, { path: "/" });
      return reply.status(401).send({ error: "Session expired" });
    }

    return { email: session.email };
  });
}

export function getSessionToken(
  cookies: Record<string, string | undefined>,
): { sid: string; token: string } | null {
  const sid = cookies["sid"];
  if (!sid) return null;
  const session = sessionStore.get(sid);
  if (!session) return null;
  return { sid, token: decryptToken(session.token, config.sessionSecret) };
}
