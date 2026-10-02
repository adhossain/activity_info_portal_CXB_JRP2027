import type { FormElement, FormSchema } from "./api.js";
import { evaluate, toText, Unknown } from "./formula.js";
import type { Resolver, Val } from "./formula.js";

export type FlatRow = Record<string, unknown>;

export interface FormStore {
  schemas: Map<string, FormSchema>;
  rows: Map<string, FlatRow[]>;
  rowsById: Map<string, Map<string, FlatRow>>;
}

export function isRefType(type: string) {
  return type === "reference" || type === "multiselectreference";
}

export function refTargets(el: FormElement): string[] {
  return el.typeParameters?.range?.map((r) => r.formId) ?? [];
}

/** Reference values are "formId:recordId"; single refs are a string, multi refs an array. */
export function refList(v: unknown): string[] {
  if (v == null || v === "") return [];
  const arr = Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim());
  return arr.filter(Boolean);
}

export function splitRef(ref: string, fallbackFormId?: string): [string, string] {
  const i = ref.indexOf(":");
  if (i < 0) return [fallbackFormId ?? "", ref];
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export function enumIds(v: unknown): string[] {
  if (v == null || v === "") return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function elementIndex(schema: FormSchema) {
  const m = new Map<string, FormElement>();
  for (const el of schema.elements) {
    m.set(el.id, el);
    if (el.code && !m.has(el.code)) m.set(el.code, el);
  }
  for (const el of schema.elements) if (!m.has(el.label)) m.set(el.label, el);
  return m;
}

const indexCache = new WeakMap<FormSchema, Map<string, FormElement>>();
export function findElement(schema: FormSchema, key: string): FormElement | undefined {
  let idx = indexCache.get(schema);
  if (!idx) {
    idx = elementIndex(schema);
    indexCache.set(schema, idx);
  }
  return idx.get(key);
}

/** Column name ActivityInfo uses for a field in the flat query. */
function columnKey(el: FormElement) {
  return el.code || el.label;
}

let calcDepth = 0;

/** Resolves formulas against a record being entered (values keyed by field id). */
export class RecordScope implements Resolver {
  constructor(
    public schema: FormSchema,
    public values: Record<string, unknown>,
    public store: FormStore,
    public recordId: string,
    public parent?: RecordScope,
    public children: Record<string, RecordScope[]> = {},
  ) {}

  with(fieldId: string, value: unknown): RecordScope {
    return new RecordScope(
      this.schema, { ...this.values, [fieldId]: value }, this.store, this.recordId, this.parent, this.children,
    );
  }

  calc(el: FormElement): Val {
    const f = el.typeParameters?.formula;
    if (!f || calcDepth > 20) throw new Unknown("calc");
    calcDepth++;
    try {
      return evaluate(f, this);
    } finally {
      calcDepth--;
    }
  }

  resolve(path: string[]): Val {
    const [head, ...rest] = path;
    if (head === "@parent") {
      if (!this.parent) throw new Unknown("@parent");
      return rest.length ? this.parent.resolve(rest) : this.parent.recordId;
    }
    if (head === "_id" || head === "@id") return this.recordId;
    const el = findElement(this.schema, head);
    if (!el) throw new Unknown(head);
    const raw = this.values[el.id];
    switch (el.type) {
      case "subform": {
        const rows = this.children[el.id] ?? [];
        return rest.length ? rows.map((r) => r.resolve(rest)) : rows.map((r) => r.recordId);
      }
      case "calculated":
        if (rest.length) throw new Unknown("path into calculated");
        return this.calc(el);
      case "enumerated":
        return enumVal(el, enumIds(raw), rest);
      case "reference":
      case "multiselectreference": {
        const refs = refList(raw);
        const results = refs.map((r) =>
          rest.length === 0 || rest[0] === "_id" || rest[0] === "@id"
            ? splitRef(r)[1]
            : rowScopeFor(this.store, r).resolve(rest),
        );
        return el.type === "reference" ? (results[0] ?? null) : results;
      }
      default:
        if (rest.length) throw new Unknown("path into scalar");
        return scalar(raw);
    }
  }
}

/** Resolves formulas against a row of a reference table's flat query. */
export class RowScope implements Resolver {
  constructor(
    public schema: FormSchema,
    public row: FlatRow,
    public prefix: string,
    public store: FormStore,
  ) {}

  resolve(path: string[]): Val {
    const [head, ...rest] = path;
    if (head === "_id" || head === "@id") return scalar(this.row[this.prefix + "@id"]);
    const el = findElement(this.schema, head);
    if (!el) throw new Unknown(head);
    const key = this.prefix + columnKey(el);
    if (isRefType(el.type)) {
      const id = this.row[key + ".@id"];
      if (rest.length === 0 || rest[0] === "_id" || rest[0] === "@id") return scalar(id);
      const target = refTargets(el)[0];
      const tSchema = this.store.schemas.get(target);
      if (!tSchema) throw new Unknown("schema " + target);
      const nested = findElement(tSchema, rest[0]);
      if (nested && key + "." + columnKey(nested) in this.row) {
        return new RowScope(tSchema, this.row, key + ".", this.store).resolve(rest);
      }
      if (id == null) return null;
      return rowScopeFor(this.store, `${target}:${id}`).resolve(rest);
    }
    if (!(key in this.row)) throw new Unknown("column " + key);
    const v = this.row[key];
    if (el.type === "enumerated") {
      const labels = v == null ? [] : String(v).split(",").map((s) => s.trim());
      if (rest.length) {
        const opt = el.typeParameters?.values?.find((o) => o.id === rest[0]);
        if (!opt) throw new Unknown("enum value");
        return labels.includes(opt.label);
      }
      return v == null ? null : String(v);
    }
    if (rest.length) throw new Unknown("path into scalar");
    return scalar(v);
  }
}

export function rowScopeFor(store: FormStore, ref: string): RowScope {
  const [formId, recId] = splitRef(ref);
  const schema = store.schemas.get(formId);
  const row = store.rowsById.get(formId)?.get(recId);
  if (!schema || !row) throw new Unknown("row " + ref);
  return new RowScope(schema, row, "", store);
}

function enumVal(el: FormElement, ids: string[], rest: string[]): Val {
  const values = el.typeParameters?.values ?? [];
  if (rest.length) {
    if (!values.some((v) => v.id === rest[0])) throw new Unknown("enum value " + rest[0]);
    return ids.includes(rest[0]);
  }
  const labels = ids.map((id) => values.find((v) => v.id === id)?.label ?? id);
  if (el.typeParameters?.cardinality?.toLowerCase() === "multiple") return labels;
  return labels[0] ?? null;
}

function scalar(v: unknown): Val {
  if (v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) return v;
  return JSON.stringify(v);
}

/** The text ActivityInfo shows for a record of a reference table. */
export function recordLabel(schema: FormSchema | undefined, row: FlatRow | undefined): string {
  if (!row) return "";
  if (!schema) return String(row["@id"] ?? "");
  const els = schema.elements;
  const byCode = els.find((e) => e.code === "record_label");
  const calcLabel = els.find((e) => e.type === "calculated" && /label/i.test(e.label));
  const pick = byCode ?? calcLabel;
  if (pick && row[columnKey(pick)]) return String(row[columnKey(pick)]);
  const keyParts = els
    .filter((e) => e.key && !isRefType(e.type))
    .map((e) => row[columnKey(e)])
    .filter((v) => v != null && v !== "");
  if (keyParts.length) return keyParts.map(String).join(" - ");
  const text = els.find((e) => e.type === "FREE_TEXT" && row[columnKey(e)]);
  return text ? String(row[columnKey(text)]) : String(row["@id"] ?? "");
}

export function refLabel(store: FormStore, ref: string): string {
  const [formId, recId] = splitRef(ref);
  const row = store.rowsById.get(formId)?.get(recId);
  return row ? recordLabel(store.schemas.get(formId), row) : recId;
}

/** Human-readable text for a stored field value. */
export function formatValue(el: FormElement, v: unknown, store: FormStore): string {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "";
  switch (el.type) {
    case "enumerated": {
      const values = el.typeParameters?.values ?? [];
      return enumIds(v).map((id) => values.find((o) => o.id === id)?.label ?? id).join(", ");
    }
    case "reference":
    case "multiselectreference":
      return refList(v).map((r) => refLabel(store, r)).join("; ");
    case "geopoint": {
      const g = v as { latitude?: number; longitude?: number };
      return `${g.latitude ?? ""}, ${g.longitude ?? ""}`;
    }
    case "attachment":
      return (Array.isArray(v) ? v : [v]).map((a) => (a as { filename?: string }).filename ?? "file").join(", ");
    case "quantity":
      return typeof v === "number" ? toText(v) : String(v);
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}
