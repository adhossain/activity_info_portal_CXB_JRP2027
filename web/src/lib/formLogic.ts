import type { FormElement, FormSchema, Grant, RecordChange } from "./api.js";
import { isBlank, toText, truthy, tryEval } from "./formula.js";
import type { Val } from "./formula.js";
import { findElement, RecordScope, refTargets, RowScope, splitRef } from "./scope.js";
import type { FlatRow, FormStore } from "./scope.js";
import type { RecordNode } from "./formStore.js";
import { choiceAllowed, portalError, recordError } from "./portalRules.js";

export interface ScopeTree {
  node: RecordNode;
  schema: FormSchema;
  scope: RecordScope;
  children: Record<string, ScopeTree[]>;
}

export function buildScopeTree(node: RecordNode, store: FormStore, parent?: RecordScope): ScopeTree {
  const schema = store.schemas.get(node.formId)!;
  const scope = new RecordScope(schema, node.fields, store, node.recordId, parent);
  const children: Record<string, ScopeTree[]> = {};
  for (const el of schema.elements) {
    if (el.type !== "subform") continue;
    const rows = (node.subforms[el.id] ?? []).filter((r) => !r.deleted && store.schemas.has(r.formId));
    children[el.id] = rows.map((r) => buildScopeTree(r, store, scope));
    scope.children[el.id] = children[el.id].map((t) => t.scope);
  }
  // Formulas see hidden answers as empty, matching what is saved (hidden answers are cleared).
  const vis = computeVisibility(schema, scope);
  const visible: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.fields)) {
    const el = findElement(schema, k);
    if (!el || !isInput(el) || vis.relevant.has(k)) visible[k] = v;
  }
  scope.values = visible;
  return { node, schema, scope, children };
}

const NON_INPUT = new Set(["section", "note", "calculated", "subform", "reversereference", "Serial"]);

export function isInput(el: FormElement) {
  return !NON_INPUT.has(el.type);
}

function holds(cond: string | undefined, scope: RecordScope, unknown: boolean): boolean {
  if (!cond) return true;
  const r = tryEval(cond, scope);
  return r === undefined ? unknown : truthy(r);
}

export interface Visibility {
  /** Fields whose relevance rules (and their section's) pass. */
  relevant: Set<string>;
  /** Relevant fields that are also meant to be shown during data entry. */
  shown: Set<string>;
}

export function computeVisibility(schema: FormSchema, scope: RecordScope): Visibility {
  const relevant = new Set<string>();
  const shown = new Set<string>();
  let hiddenLevel: number | null = null;
  for (const el of schema.elements) {
    if (el.type === "section") {
      const lvl = el.typeParameters?.indentationLevel ?? 1;
      if (hiddenLevel !== null && lvl <= hiddenLevel) hiddenLevel = null;
      if (hiddenLevel !== null) continue;
      if (!holds(el.relevanceCondition, scope, true)) {
        hiddenLevel = lvl;
        continue;
      }
    } else if (hiddenLevel !== null || !holds(el.relevanceCondition, scope, true)) {
      continue;
    }
    relevant.add(el.id);
    if (el.dataEntryVisible !== false) shown.add(el.id);
  }
  return { relevant, shown };
}

export function isRequired(el: FormElement, scope: RecordScope): boolean {
  if (el.requiredCondition) return holds(el.requiredCondition, scope, !!el.required);
  return !!el.required;
}

export function isEmptyValue(v: unknown) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function calcValue(el: FormElement, scope: RecordScope): Val | undefined {
  const f = el.typeParameters?.formula;
  return f ? tryEval(f, scope) : undefined;
}

export type Errors = Map<string, string>;
export const errKey = (recordId: string, fieldId: string) => `${recordId}:${fieldId}`;
export const ROW_ERR = "__row";

export function validateTree(tree: ScopeTree, errors: Errors = new Map()): Errors {
  const { schema, scope, node } = tree;
  const vis = computeVisibility(schema, scope);
  for (const el of schema.elements) {
    if (!vis.shown.has(el.id)) continue;
    if (el.type === "subform") {
      const rows = tree.children[el.id] ?? [];
      if (isRequired(el, scope) && rows.length === 0) errors.set(errKey(node.recordId, el.id), "Add at least one row.");
      checkUniqueRows(el, rows, errors);
      for (const r of rows) validateTree(r, errors);
      continue;
    }
    if (!isInput(el) || el.type === "attachment") continue;
    const v = node.fields[el.id];
    if (isEmptyValue(v)) {
      if (isRequired(el, scope)) errors.set(errKey(node.recordId, el.id), "This field is required.");
      continue;
    }
    if (el.validationCondition && !holds(el.validationCondition, scope, true)) {
      errors.set(errKey(node.recordId, el.id), el.validationMessage || "This answer does not meet the rule for this field.");
      continue;
    }
    const extra = portalError(el, v, scope, (e) => calcValue(e, scope));
    if (extra) errors.set(errKey(node.recordId, el.id), extra);
  }
  const recErr = recordError(scope);
  if (recErr) {
    const key = errKey(node.recordId, ROW_ERR);
    errors.set(key, errors.has(key) ? `${errors.get(key)} ${recErr}` : recErr);
  }
  return errors;
}

function checkUniqueRows(subformEl: FormElement, rows: ScopeTree[], errors: Errors) {
  if (rows.length < 2) return;
  const uniqueEls = rows[0].schema.elements.filter((e) => e.unique);
  for (const u of uniqueEls) {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const v = u.type === "calculated" ? calcValue(u, r.scope) : (r.node.fields[u.id] as Val);
      if (v === undefined || isBlank(v)) continue;
      const k = toText(v);
      if (seen.has(k)) {
        errors.set(errKey(r.node.recordId, ROW_ERR), `This row repeats an earlier row in “${subformEl.label}”. Each row must be different.`);
      } else {
        seen.set(k, r.node.recordId);
      }
    }
  }
}

export function subtreeIds(tree: ScopeTree, out = new Set<string>()): Set<string> {
  out.add(tree.node.recordId);
  for (const rows of Object.values(tree.children)) for (const r of rows) subtreeIds(r, out);
  return out;
}

function payload(schema: FormSchema, fields: Record<string, unknown>, vis: Visibility) {
  const out: Record<string, unknown> = {};
  for (const el of schema.elements) {
    if (!isInput(el) || el.type === "attachment") continue;
    const v = fields[el.id];
    out[el.id] = vis.relevant.has(el.id) && !isEmptyValue(v) ? v : null;
  }
  return out;
}

/**
 * Builds the batch for one save, parents before children. Rows of subforms that
 * are hidden by their rules are left untouched rather than deleted.
 */
export function collectChanges(
  tree: ScopeTree,
  parentRecordId: string | null,
  isRoot = true,
  out: RecordChange[] = [],
): RecordChange[] {
  const { node, schema, scope } = tree;
  const vis = computeVisibility(schema, scope);
  if (isRoot || node.isNew || node.dirty) {
    out.push({
      formId: node.formId,
      recordId: node.recordId,
      parentRecordId,
      deleted: false,
      fields: payload(schema, node.fields, vis),
    });
  }
  for (const el of schema.elements) {
    if (el.type !== "subform" || !vis.relevant.has(el.id)) continue;
    for (const row of node.subforms[el.id] ?? []) {
      if (row.deleted && !row.isNew) {
        out.push({ formId: row.formId, recordId: row.recordId, parentRecordId: node.recordId, deleted: true, fields: null });
      }
    }
    for (const child of tree.children[el.id] ?? []) collectChanges(child, node.recordId, false, out);
  }
  return out;
}

export interface Constraint {
  target: string;
  recordId: string;
}

/** Record-level permission filters such as `"<recordId>" == <form or field id>`. */
export function grantConstraints(grants: Grant[], formId: string): Constraint[] {
  const out: Constraint[] = [];
  const seen = new Set<string>();
  for (const g of grants) {
    if (g.resourceId !== formId) continue;
    for (const op of g.operations) {
      if (!op.filter || !["ADD_RECORD", "EDIT_RECORD"].includes(op.operation)) continue;
      const pairs: [string, string][] = [];
      for (const m of op.filter.matchAll(/"([^"]+)"\s*==\s*([A-Za-z_][A-Za-z0-9_]*)/g)) pairs.push([m[2], m[1]]);
      for (const m of op.filter.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*==\s*"([^"]+)"/g)) pairs.push([m[1], m[2]]);
      for (const [target, recordId] of pairs) {
        const k = `${target}=${recordId}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ target, recordId });
        }
      }
    }
  }
  return out;
}

export interface Candidate {
  id: string;
  formId: string;
  row: FlatRow;
}

/** Rows of the referenced tables that pass the permission filter and the field's own rule. */
export function getCandidates(el: FormElement, scope: RecordScope, constraint?: Constraint): Candidate[] {
  let list: Candidate[] = refTargets(el).flatMap((fid) =>
    (scope.store.rows.get(fid) ?? []).map((row) => ({ id: `${fid}:${row["@id"]}`, formId: fid, row })),
  );
  if (constraint) list = list.filter((c) => splitRef(c.id)[1] === constraint.recordId);
  const cond = el.validationCondition;
  if (cond) {
    list = list.filter((c) => {
      const r = tryEval(cond, scope.with(el.id, el.type === "multiselectreference" ? [c.id] : c.id));
      return r === undefined || truthy(r);
    });
  }
  return list.filter((c) => choiceAllowed(el, scope, c.id));
}

export interface LookupLevel {
  label: string;
  value: string;
}

/** The step-by-step levels (e.g. Objective, Activity Group, Sub-Activity) of a chosen lookup record. */
export function lookupLevels(el: FormElement, ref: string | undefined, store: FormStore): LookupLevel[] | undefined {
  const levels = el.typeParameters?.lookupConfigs;
  if (!levels?.length || !ref) return undefined;
  const [fid, rid] = splitRef(ref);
  const schema = store.schemas.get(fid);
  const row = store.rowsById.get(fid)?.get(rid);
  if (!schema || !row) return undefined;
  const rs = new RowScope(schema, row, "", store);
  return levels.map((l) => {
    const v = tryEval(l.formula, rs);
    return { label: l.lookupLabel, value: v == null ? "" : toText(v) };
  });
}

/** A reference field picked through two or more lookup levels (a hierarchy worth showing). */
export function hierarchyField(schema: FormSchema): FormElement | undefined {
  return schema.elements.find((e) => e.type === "reference" && (e.typeParameters?.lookupConfigs?.length ?? 0) >= 2);
}

/** Permission filters only bind the record's single-choice reference to that table. */
export function constraintFor(el: FormElement, constraints: Constraint[]): Constraint | undefined {
  if (el.type !== "reference") return undefined;
  return constraints.find((c) => c.target === el.id || refTargets(el).includes(c.target));
}
