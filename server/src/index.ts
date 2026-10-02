import dns from "node:dns";
import net from "node:net";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";

// The host has no working IPv6 route, and Node gives each address family only
// 250 ms by default, so outgoing calls to ActivityInfo intermittently failed.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const app = Fastify({
  logger: {
    level: "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
    redact: ["req.headers.cookie", "req.headers.authorization"],
  },
  trustProxy: config.trustProxy,
});

await app.register(cookie);
await app.register(formbody);
await app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});

await app.register(authRoutes);
await app.register(dataRoutes);

app.get("/api/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
