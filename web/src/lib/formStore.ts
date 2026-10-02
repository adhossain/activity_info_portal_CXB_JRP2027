import { api } from "./api.js";
import type { FormSchema } from "./api.js";
import { extraRowForms } from "./portalRules.js";
import { isRefType, refTargets } from "./scope.js";
import type { FlatRow, FormStore } from "./scope.js";

const TTL = 5 * 60 * 1000;
const schemaCache = new Map<string, { at: number; p: Promise<FormSchema> }>();
const rowsCache = new Map<string, { at: number; p: Promise<FlatRow[]> }>();

function cached<T>(m: Map<string, { at: number; p: Promise<T> }>, key: string, load: () => Promise<T>) {
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = load();
  m.set(key, { at: Date.now(), p });
  p.catch(() => m.delete(key));
  return p;
}

export function loadSchema(formId: string) {
  return cached(schemaCache, formId, () => api.getFormSchema(formId));
}

function loadRows(formId: string) {
  return cached(rowsCache, formId, () => api.getFormRecords(formId).then((r) => r.rows));
}

const NESTED_SCHEMA_DEPTH = 3;

/**
 * Loads everything needed to evaluate rules for a form: the schemas of the form
 * and all its subforms, the rows of every table its reference fields point to,
 * and the schemas of tables those tables point to (for paths like a.b.c).
 */
export async function loadFormStore(rootFormId: string): Promise<FormStore> {
  const schemas = new Map<string, FormSchema>();
  const rowLoads = new Map<string, Promise<FlatRow[]>>();
  const startRows = (fid: string) => {
    if (!rowLoads.has(fid)) rowLoads.set(fid, loadRows(fid).catch(() => [] as FlatRow[]));
  };
  extraRowForms(rootFormId).forEach(startRows);

  // One call returns the form, its subforms and the tables they reference.
  const bundled = await api.getFormTree(rootFormId).catch(() => [] as FormSchema[]);
  for (const s of bundled) {
    schemas.set(s.id, s);
    schemaCache.set(s.id, { at: Date.now(), p: Promise.resolve(s) });
  }

  const visited = new Set<string>();
  let level: { id: string; tree: boolean; depth: number }[] = [{ id: rootFormId, tree: true, depth: 0 }];
  while (level.length) {
    const todo = level.filter((f) => !visited.has(f.id));
    todo.forEach((f) => visited.add(f.id));
    const loaded = await Promise.all(
      todo.map((f) =>
        (schemas.get(f.id) ? Promise.resolve(schemas.get(f.id)!) : loadSchema(f.id))
          .then((s) => ({ f, s }))
          .catch(() => null),
      ),
    );
    const next: typeof level = [];
    for (const item of loaded) {
      if (!item) continue;
      const { f, s } = item;
      schemas.set(f.id, s);
      for (const el of s.elements) {
        if (el.type === "subform" && f.tree && el.typeParameters?.formId) {
          next.push({ id: el.typeParameters.formId, tree: true, depth: 0 });
        }
        if (isRefType(el.type)) {
          for (const t of refTargets(el)) {
            if (f.tree) startRows(t);
            if (f.depth < NESTED_SCHEMA_DEPTH) next.push({ id: t, tree: false, depth: f.depth + 1 });
          }
        }
      }
    }
    level = next;
  }

  const rows = new Map<string, FlatRow[]>();
  const rowsById = new Map<string, Map<string, FlatRow>>();
  await Promise.all(
    [...rowLoads].map(async ([fid, load]) => {
      const list = await load;
      rows.set(fid, list);
      rowsById.set(fid, new Map(list.map((r) => [String(r["@id"]), r])));
    }),
  );
  return { schemas, rows, rowsById };
}

export interface RecordNode {
  formId: string;
  recordId: string;
  fields: Record<string, unknown>;
  subforms: Record<string, RecordNode[]>;
  isNew?: boolean;
  deleted?: boolean;
  dirty?: boolean;
}

export function defaultFields(schema: FormSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const el of schema.elements) {
    const d = el.defaultValue;
    if (d == null || d === "") continue;
    if (el.type === "enumerated" && el.typeParameters?.cardinality?.toLowerCase() === "multiple") {
      out[el.id] = Array.isArray(d) ? d : [d];
    } else if (el.type === "quantity") {
      const n = Number(d);
      if (!Number.isNaN(n)) out[el.id] = n;
    } else if (typeof d === "string" || typeof d === "number") {
      out[el.id] = d;
    }
  }
  return out;
}

/** Loads a record and, recursively, all rows of its subforms. */
export async function loadRecordTree(
  store: FormStore,
  formId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<RecordNode> {
  const schema = store.schemas.get(formId);
  const node: RecordNode = { formId, recordId, fields, subforms: {} };
  if (!schema) return node;
  await Promise.all(
    schema.elements
      .filter((el) => el.type === "subform" && el.typeParameters?.formId)
      .map(async (el) => {
        const sfId = el.typeParameters!.formId!;
        const recs = await api.getSubformRecords(sfId, recordId);
        node.subforms[el.id] = await Promise.all(
          recs.map((r) => loadRecordTree(store, sfId, r.recordId, r.fields ?? {})),
        );
      }),
  );
  return node;
}
