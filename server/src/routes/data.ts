import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ai, ActivityInfoError } from "../activityinfo-client.js";
import type { RecordChange } from "../activityinfo-client.js";
import { getSessionToken } from "./auth.js";
import { getCached, setCache } from "../schema-cache.js";

const ID_RE = /^[a-z][a-z0-9]{0,63}$/;

function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sess = getSessionToken(req.cookies);
  if (!sess) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  return sess;
}

async function forward<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ActivityInfoError) {
      return reply.status(err.status).send({ error: err.message, detail: err.body });
    }
    throw err;
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseChanges(body: unknown): RecordChange[] | string {
  const changes = (body as { changes?: unknown })?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return "changes must be a non-empty array";
  if (changes.length > 500) return "too many changes in one request";
  const out: RecordChange[] = [];
  for (const c of changes as Record<string, unknown>[]) {
    if (typeof c?.formId !== "string" || !ID_RE.test(c.formId)) return "invalid formId";
    if (typeof c.recordId !== "string" || !ID_RE.test(c.recordId)) return "invalid recordId";
    if (c.parentRecordId != null && (typeof c.parentRecordId !== "string" || !ID_RE.test(c.parentRecordId))) {
      return "invalid parentRecordId";
    }
    const deleted = c.deleted === true;
    if (!deleted && (typeof c.fields !== "object" || c.fields === null || Array.isArray(c.fields))) {
      return "fields must be an object";
    }
    out.push({
      formId: c.formId,
      recordId: c.recordId,
      parentRecordId: (c.parentRecordId as string | undefined) ?? null,
      deleted,
      fields: deleted ? null : (c.fields as Record<string, unknown>),
    });
  }
  return out;
}

export async function dataRoutes(app: FastifyInstance) {
  app.get("/api/databases", async (req, reply) => {
    const sess = requireAuth(req, reply);
    if (!sess) return;
    return forward(reply, () => ai.getDatabases(sess.token));
  });

  app.get<{ Params: { databaseId: string } }>(
    "/api/databases/:databaseId",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { databaseId } = req.params;
      const cacheKey = `db:${databaseId}`;
      const cached = getCached(sess.sid, cacheKey);
      if (cached) return cached;
      return forward(reply, async () => {
        const data = await ai.getDatabaseTree(sess.token, databaseId);
        setCache(sess.sid, cacheKey, data);
        return data;
      });
    },
  );

  app.get<{ Params: { databaseId: string } }>(
    "/api/databases/:databaseId/grants",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { databaseId } = req.params;
      return forward(reply, async () => {
        const tree = (await ai.getDatabaseTree(sess.token, databaseId)) as {
          grants?: { resourceId: string; operations: { operation: string; filter: string | null }[] }[];
        };
        return { grants: tree.grants ?? [] };
      });
    },
  );

  app.get<{ Params: { formId: string } }>(
    "/api/forms/:formId/schema",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId } = req.params;
      const cacheKey = `schema:${formId}`;
      const cached = getCached(sess.sid, cacheKey);
      if (cached) return cached;
      return forward(reply, async () => {
        const data = await ai.getFormSchema(sess.token, formId);
        setCache(sess.sid, cacheKey, data);
        return data;
      });
    },
  );

  app.get<{ Params: { formId: string } }>(
    "/api/forms/:formId/tree",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId } = req.params;
      const cacheKey = `tree:${formId}`;
      const cached = getCached(sess.sid, cacheKey);
      if (cached) return cached;
      return forward(reply, async () => {
        const tree = (await ai.getFormTree(sess.token, formId)) as {
          forms?: Record<string, { schema?: unknown }>;
        };
        const schemas = Object.values(tree.forms ?? {}).map((f) => f.schema).filter(Boolean);
        setCache(sess.sid, cacheKey, schemas);
        return schemas;
      });
    },
  );

  app.get<{ Params: { formId: string } }>(
    "/api/forms/:formId/records",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId } = req.params;
      return forward(reply, async () => {
        const flat = (await ai.getFormRecords(sess.token, formId)) as Record<string, unknown>[];
        const allKeys = flat.length > 0 ? Object.keys(flat[0]) : [];
        const keys = allKeys.filter(
          (k) => k !== "@id" && k !== "@lastEditTime" && !k.endsWith(".@id"),
        );
        return { keys, rows: flat };
      });
    },
  );

  app.get<{ Params: { formId: string; recordId: string } }>(
    "/api/forms/:formId/records/:recordId",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId, recordId } = req.params;
      return forward(reply, () => ai.getRecord(sess.token, formId, recordId));
    },
  );

  app.get<{ Params: { formId: string; parentRecordId: string } }>(
    "/api/forms/:formId/subrecords/:parentRecordId",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId, parentRecordId } = req.params;
      return forward(reply, async () => {
        const rows = (await ai.queryColumns(sess.token, formId, {
          id: "_id",
          parent: "@parent",
        })) as { id: string; parent: string }[];
        const ids = rows.filter((r) => r.parent === parentRecordId).map((r) => r.id);
        return mapLimited(ids, 8, (id) => ai.getRecord(sess.token, formId, id));
      });
    },
  );

  app.post("/api/changes", async (req, reply) => {
    const sess = requireAuth(req, reply);
    if (!sess) return;
    const changes = parseChanges(req.body);
    if (typeof changes === "string") return reply.status(400).send({ error: changes });
    return forward(reply, async () => {
      await ai.updateRecords(sess.token, changes);
      return { ok: true };
    });
  });

  app.delete<{ Params: { formId: string; recordId: string } }>(
    "/api/forms/:formId/records/:recordId",
    async (req, reply) => {
      const sess = requireAuth(req, reply);
      if (!sess) return;
      const { formId, recordId } = req.params;
      return forward(reply, async () => {
        await ai.updateRecords(sess.token, [{ formId, recordId, deleted: true, fields: null }]);
        return { ok: true };
      });
    },
  );
}
