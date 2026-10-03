import { useEffect, useMemo, useState } from "react";
import type { FormElement, Grant, RecordChange } from "../lib/api.js";
import { generateRecordId } from "../lib/cuid.js";
import { toText, tryEval } from "../lib/formula.js";
import { defaultFields } from "../lib/formStore.js";
import type { RecordNode } from "../lib/formStore.js";
import {
  buildScopeTree, calcValue, collectChanges, computeVisibility, constraintFor, errKey,
  getCandidates, grantConstraints, isRequired, ROW_ERR, subtreeIds, validateTree,
} from "../lib/formLogic.js";
import type { Candidate, Constraint, Errors, ScopeTree } from "../lib/formLogic.js";
import { disabledOptions, hiddenOptions, maxLengthFor, populationCap } from "../lib/portalRules.js";
import { HierarchyRows } from "./HierarchyOverview.js";
import { enumIds, recordLabel, refList, refTargets, RowScope, splitRef } from "../lib/scope.js";
import type { FlatRow, FormStore, RecordScope } from "../lib/scope.js";

interface Ctx {
  store: FormStore;
  errors: Errors;
  constraints: Constraint[];
  disabled: boolean;
  setField: (recordId: string, fieldId: string, value: unknown) => void;
  updateNode: (recordId: string, fn: (n: RecordNode) => RecordNode) => void;
}

function mapTree(node: RecordNode, recordId: string, fn: (n: RecordNode) => RecordNode): RecordNode {
  if (node.recordId === recordId) return fn(node);
  let changed = false;
  const subforms: Record<string, RecordNode[]> = {};
  for (const [k, rows] of Object.entries(node.subforms)) {
    subforms[k] = rows.map((r) => {
      const n = mapTree(r, recordId, fn);
      if (n !== r) changed = true;
      return n;
    });
  }
  return changed ? { ...node, subforms } : node;
}

export function SchemaForm({
  store,
  initial,
  parentRecordId,
  grants,
  onSubmit,
  submitLabel,
}: {
  store: FormStore;
  initial: RecordNode;
  parentRecordId: string | null;
  grants: Grant[];
  onSubmit: (changes: RecordChange[]) => Promise<void>;
  submitLabel: string;
}) {
  const [root, setRoot] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const constraints = useMemo(() => grantConstraints(grants, initial.formId), [grants, initial.formId]);
  const rootSchema = store.schemas.get(initial.formId)!;

  const updateNode = (recordId: string, fn: (n: RecordNode) => RecordNode) =>
    setRoot((r) => mapTree(r, recordId, fn));
  const setField = (recordId: string, fieldId: string, value: unknown) =>
    updateNode(recordId, (n) => ({ ...n, fields: { ...n.fields, [fieldId]: value }, dirty: true }));

  useEffect(() => {
    if (!initial.isNew) return;
    for (const el of rootSchema.elements) {
      const c = constraintFor(el, constraints);
      if (!c) continue;
      const target = refTargets(el).find((t) => t === c.target) ?? refTargets(el)[0];
      setRoot((r) => (r.fields[el.id] ? r : { ...r, fields: { ...r.fields, [el.id]: `${target}:${c.recordId}` } }));
    }
  }, [constraints, initial.isNew, rootSchema]);

  const tree = buildScopeTree(root, store);
  const errors = showErrors ? validateTree(tree) : new Map<string, string>();
  const ctx: Ctx = { store, errors, constraints, disabled: submitting, setField, updateNode };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setShowErrors(true);
    const errs = validateTree(tree);
    if (errs.size > 0) {
      setError(`${errs.size} answer${errs.size > 1 ? "s need" : " needs"} attention. The fields are marked in red.`);
      setTimeout(() => document.querySelector(".has-error")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(collectChanges(tree, parentRecordId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Fields tree={tree} ctx={ctx} isRoot />
      {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Fields({ tree, ctx, isRoot }: { tree: ScopeTree; ctx: Ctx; isRoot?: boolean }) {
  const { schema, scope, node } = tree;
  const vis = computeVisibility(schema, scope);
  return (
    <>
      {schema.elements.map((el) => {
        if (!vis.shown.has(el.id)) return null;
        switch (el.type) {
          case "section":
            return <SectionHeader key={el.id} el={el} />;
          case "note":
            return (
              <div key={el.id} className="form-note">
                <strong>{el.label}</strong>
                {el.description && <div>{el.description}</div>}
              </div>
            );
          case "calculated": {
            const v = calcValue(el, scope);
            const text = v === undefined || v === null ? "" : toText(v);
            return (
              <div key={el.id} className="field-view">
                <div className="field-label">{el.label}</div>
                <div className={`field-value${text ? "" : " empty-val"}`}>{text || "—"}</div>
              </div>
            );
          }
          case "subform":
            return <SubformBlock key={el.id} el={el} tree={tree} ctx={ctx} />;
          case "reversereference":
          case "Serial":
            return null;
          default:
            return (
              <FieldInput
                key={el.id}
                el={el}
                value={node.fields[el.id]}
                onChange={(v) => ctx.setField(node.recordId, el.id, v)}
                scope={scope}
                ctx={ctx}
                error={ctx.errors.get(errKey(node.recordId, el.id))}
                constraint={isRoot ? constraintFor(el, ctx.constraints) : undefined}
              />
            );
        }
      })}
    </>
  );
}

export function SectionHeader({ el }: { el: FormElement }) {
  const lvl = el.typeParameters?.indentationLevel ?? 1;
  return (
    <div className={lvl > 1 ? "section-header section-sub" : "section-header"}>
      {el.label}
      {el.description && <div className="section-desc">{el.description}</div>}
    </div>
  );
}

function FieldInput({
  el, value, onChange, scope, ctx, error, constraint,
}: {
  el: FormElement;
  value: unknown;
  onChange: (v: unknown) => void;
  scope: RecordScope;
  ctx: Ctx;
  error?: string;
  constraint?: Constraint;
}) {
  const required = isRequired(el, scope);
  const disabled = ctx.disabled;
  const tp = el.typeParameters;
  const maxLen = maxLengthFor(el, scope.schema.id);
  const textLen = typeof value === "string" ? value.length : 0;
  const cap = el.type === "quantity" ? populationCap(el, scope) : undefined;
  let input: React.ReactNode;

  switch (el.type) {
    case "FREE_TEXT":
      input = <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
      break;
    case "NARRATIVE":
      input = <textarea rows={4} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
      break;
    case "quantity":
      input = (
        <div className="inline-row">
          <input
            type="number"
            step="any"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            disabled={disabled}
          />
          {tp?.units && <span className="muted">{tp.units}</span>}
        </div>
      );
      break;
    case "date":
      input = <input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
      break;
    case "month":
      input = <input type="month" placeholder="YYYY-MM" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
      break;
    case "enumerated":
      input = <EnumInput el={el} formId={scope.schema.id} value={value} onChange={onChange} disabled={disabled} blocked={disabledOptions(el, scope)} />;
      break;
    case "reference":
      input = <ReferenceInput el={el} value={value} onChange={onChange} scope={scope} ctx={ctx} constraint={constraint} />;
      break;
    case "multiselectreference":
      input = <MultiReferenceInput el={el} value={value} onChange={onChange} scope={scope} ctx={ctx} />;
      break;
    case "geopoint": {
      const g = (value && typeof value === "object" ? value : {}) as { latitude?: number; longitude?: number };
      const set = (k: "latitude" | "longitude", s: string) => {
        const next = { ...g, [k]: s === "" ? undefined : Number(s) };
        onChange(next.latitude == null && next.longitude == null ? null : next);
      };
      input = (
        <div className="inline-row">
          <input type="number" step="any" placeholder="Latitude" value={g.latitude ?? ""} onChange={(e) => set("latitude", e.target.value)} disabled={disabled} />
          <input type="number" step="any" placeholder="Longitude" value={g.longitude ?? ""} onChange={(e) => set("longitude", e.target.value)} disabled={disabled} />
        </div>
      );
      break;
    }
    case "attachment": {
      const files = Array.isArray(value) ? (value as { filename?: string }[]) : [];
      let root = scope;
      while (root.parent) root = root.parent;
      input = (
        <div className="upload-notice" role="note">
          <div className="upload-notice-title">⚠ Upload the {el.label} in ActivityInfo</div>
          <div>
            Uploading files is not possible in this portal. Open your project in ActivityInfo and attach the file
            there. Saving here keeps any file already uploaded.
          </div>
          <div className="upload-notice-files">
            {files.length ? `Uploaded: ${files.map((f) => f.filename ?? "file").join(", ")}` : "No file uploaded yet."}
          </div>
          <a
            href={`https://www.activityinfo.org/app#form/${root.schema.id}/`}
            target="_blank"
            rel="noreferrer"
          >
            Open the form in ActivityInfo ↗
          </a>
        </div>
      );
      break;
    }
    default:
      input = <input type="text" value={value != null ? String(value) : ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
  }

  return (
    <div className={`form-group${error ? " has-error" : ""}`}>
      <div className="field-label">
        {el.label}
        {required && <span className="badge badge-required">Required</span>}
      </div>
      {el.description && <div className="field-help">{el.description}</div>}
      {input}
      {maxLen !== undefined && (
        <div className={`char-count${textLen > maxLen ? " over" : ""}`}>
          {textLen.toLocaleString()} / {maxLen.toLocaleString()} characters
        </div>
      )}
      {cap && (
        <div className="field-help">
          Population in this area: {cap.cap.toLocaleString()} ({cap.group}, {cap.area})
        </div>
      )}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function EnumInput({
  el, formId, value, onChange, disabled, blocked,
}: {
  el: FormElement;
  formId: string;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  blocked?: Map<string, string>;
}) {
  const hidden = hiddenOptions(el, formId);
  const options = (el.typeParameters?.values ?? []).filter((o) => !hidden.has(o.id));
  const multiple = el.typeParameters?.cardinality?.toLowerCase() === "multiple";
  const selected = enumIds(value);

  if (multiple) {
    return (
      <div className="choice-list">
        {options.map((o) => (
          <label key={o.id} className="choice">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              disabled={disabled || (blocked?.has(o.id) && !selected.includes(o.id))}
              onChange={(e) => {
                const next = e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id);
                onChange(next.length ? next : null);
              }}
            />
            <OptionLabel label={o.label} reason={blocked?.get(o.id)} />
          </label>
        ))}
      </div>
    );
  }

  if (options.length > 8 && el.typeParameters?.presentation !== "RADIO_BUTTON") {
    return (
      <select value={selected[0] ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={blocked?.has(o.id) && selected[0] !== o.id}>
            {o.label}{blocked?.has(o.id) ? ` (${blocked.get(o.id)})` : ""}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="choice-list">
      {options.map((o) => (
        <label key={o.id} className="choice">
          <input
            type="radio"
            checked={selected[0] === o.id}
            disabled={disabled || (blocked?.has(o.id) && selected[0] !== o.id)}
            onChange={() => onChange(o.id)}
          />
          <OptionLabel label={o.label} reason={blocked?.get(o.id)} />
        </label>
      ))}
      {selected.length > 0 && !disabled && (
        <button type="button" className="link-btn" onClick={() => onChange(null)}>Clear</button>
      )}
    </div>
  );
}

function OptionLabel({ label, reason }: { label: string; reason?: string }) {
  return (
    <span className={reason ? "choice-blocked" : undefined}>
      {label}
      {reason && <span className="choice-reason"> — not available: {reason}</span>}
    </span>
  );
}

function labelOf(store: FormStore, c: Candidate) {
  return recordLabel(store.schemas.get(c.formId), c.row);
}

const NO_MATCH = "No matching choices. This list depends on earlier answers.";

function ReferenceInput({
  el, value, onChange, scope, ctx, constraint,
}: {
  el: FormElement;
  value: unknown;
  onChange: (v: unknown) => void;
  scope: RecordScope;
  ctx: Ctx;
  constraint?: Constraint;
}) {
  const candidates = getCandidates(el, scope, constraint);
  const current = refList(value)[0] ?? "";
  if (el.typeParameters?.lookupConfigs?.length) {
    return <CascadeInput el={el} current={current} candidates={candidates} onChange={onChange} ctx={ctx} />;
  }
  return <SearchSelect current={current} candidates={candidates} onChange={onChange} ctx={ctx} />;
}

function SearchSelect({
  current, candidates, onChange, ctx,
}: {
  current: string;
  candidates: Candidate[];
  onChange: (v: unknown) => void;
  ctx: Ctx;
}) {
  const [q, setQ] = useState("");
  const opts = candidates.map((c) => ({ id: c.id, label: labelOf(ctx.store, c) }));
  const needle = q.trim().toLowerCase();
  let shown = needle ? opts.filter((o) => o.label.toLowerCase().includes(needle)) : opts;
  shown = shown.slice(0, 300);
  if (current && !shown.some((o) => o.id === current)) {
    shown = [{ id: current, label: refLabelFromStore(ctx.store, current) }, ...shown];
  }
  return (
    <>
      {opts.length > 12 && (
        <input type="text" className="search-input" placeholder="Type to filter the list…" value={q} onChange={(e) => setQ(e.target.value)} disabled={ctx.disabled} />
      )}
      <select value={current} onChange={(e) => onChange(e.target.value || null)} disabled={ctx.disabled}>
        <option value="">— Select —</option>
        {shown.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {opts.length === 0 && <div className="field-help">{NO_MATCH}</div>}
    </>
  );
}

function refLabelFromStore(store: FormStore, ref: string) {
  const [fid, rid] = splitRef(ref);
  return recordLabel(store.schemas.get(fid), store.rowsById.get(fid)?.get(rid)) || rid;
}

/** ActivityInfo "lookup" fields: pick a record step by step (e.g. Objective → Activity Group → Sub-Activity). */
function CascadeInput({
  el, current, candidates, onChange, ctx,
}: {
  el: FormElement;
  current: string;
  candidates: Candidate[];
  onChange: (v: unknown) => void;
  ctx: Ctx;
}) {
  const levels = el.typeParameters!.lookupConfigs!;
  const levelValues = (formId: string, row: FlatRow) => {
    const schema = ctx.store.schemas.get(formId);
    if (!schema) return levels.map(() => "");
    const rs = new RowScope(schema, row, "", ctx.store);
    return levels.map((l) => {
      const v = tryEval(l.formula, rs);
      return v == null ? "" : toText(v);
    });
  };
  const rows = candidates.map((c) => ({ c, vals: levelValues(c.formId, c.row) }));
  const [partial, setPartial] = useState<string[]>([]);

  let sel = partial;
  if (current) {
    const [fid, rid] = splitRef(current);
    const row = ctx.store.rowsById.get(fid)?.get(rid);
    if (row) sel = levelValues(fid, row);
  }

  const pick = (i: number, v: string) => {
    const next = v ? [...sel.slice(0, i), v] : sel.slice(0, i);
    setPartial(next);
    if (next.length === levels.length) {
      const match = rows.find((r) => r.vals.every((x, k) => x === next[k]));
      if (match) {
        onChange(match.c.id);
        return;
      }
    }
    if (current) onChange(null);
  };

  return (
    <div className="cascade">
      {levels.map((l, i) => {
        if (i > 0 && !sel[i - 1]) return null;
        const options: string[] = [];
        for (const r of rows) {
          if (!sel.slice(0, i).every((x, k) => r.vals[k] === x)) continue;
          const v = r.vals[i];
          if (v && !options.includes(v)) options.push(v);
        }
        if (sel[i] && !options.includes(sel[i])) options.unshift(sel[i]);
        return (
          <div key={l.formula + i} className="cascade-level">
            <div className="cascade-label">{l.lookupLabel}</div>
            <select value={sel[i] ?? ""} onChange={(e) => pick(i, e.target.value)} disabled={ctx.disabled}>
              <option value="">— Select {l.lookupLabel} —</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        );
      })}
      {rows.length === 0 && <div className="field-help">{NO_MATCH}</div>}
    </div>
  );
}

function MultiReferenceInput({
  el, value, onChange, scope, ctx,
}: {
  el: FormElement;
  value: unknown;
  onChange: (v: unknown) => void;
  scope: RecordScope;
  ctx: Ctx;
}) {
  const [q, setQ] = useState("");
  const selected = refList(value);
  const candidates = getCandidates(el, scope);
  const needle = q.trim().toLowerCase();
  const available = candidates
    .filter((c) => !selected.includes(c.id))
    .map((c) => ({ id: c.id, label: labelOf(ctx.store, c) }))
    .filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const set = (next: string[]) => onChange(next.length ? next : null);

  return (
    <div className="multi-ref">
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((id) => (
            <span key={id} className="chip">
              {refLabelFromStore(ctx.store, id)}
              {!ctx.disabled && (
                <button type="button" aria-label="Remove" onClick={() => set(selected.filter((s) => s !== id))}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
      <input type="text" className="search-input" placeholder="Type to search and add…" value={q} onChange={(e) => setQ(e.target.value)} disabled={ctx.disabled} />
      <div className="option-list">
        {available.slice(0, 50).map((o) => (
          <button type="button" key={o.id} className="option-row" disabled={ctx.disabled} onClick={() => { set([...selected, o.id]); setQ(""); }}>
            + {o.label}
          </button>
        ))}
        {available.length > 50 && <div className="field-help">Showing 50 of {available.length}. Type to narrow the list.</div>}
        {candidates.length === 0 && <div className="field-help">{NO_MATCH}</div>}
      </div>
    </div>
  );
}

export function rowTitle(tree: ScopeTree, index: number): string {
  const labelEl = tree.schema.elements.find((e) => e.code === "record_label" && e.type === "calculated");
  const v = labelEl ? calcValue(labelEl, tree.scope) : undefined;
  const text = v == null ? "" : toText(v).trim();
  return text && !/^\(for\s*\)$/.test(text) ? text : `Row ${index + 1}`;
}

function SubformBlock({ el, tree, ctx }: { el: FormElement; tree: ScopeTree; ctx: Ctx }) {
  const sfId = el.typeParameters?.formId ?? "";
  const sfSchema = ctx.store.schemas.get(sfId);
  const parentId = tree.node.recordId;
  const children = tree.children[el.id] ?? [];
  const error = ctx.errors.get(errKey(parentId, el.id));

  if (!sfSchema) {
    return <div className="subform-section"><div className="subform-title">{el.label}</div><div className="field-help">This sub-form could not be loaded.</div></div>;
  }

  const addRow = () => {
    const row: RecordNode = {
      formId: sfId, recordId: generateRecordId(), fields: defaultFields(sfSchema), subforms: {}, isNew: true, dirty: true,
    };
    ctx.updateNode(parentId, (n) => ({ ...n, subforms: { ...n.subforms, [el.id]: [...(n.subforms[el.id] ?? []), row] } }));
  };

  const removeRow = (row: RecordNode) => {
    if (!row.isNew && !confirm("Remove this row? It will be deleted when you save.")) return;
    ctx.updateNode(parentId, (n) => ({
      ...n,
      subforms: {
        ...n.subforms,
        [el.id]: (n.subforms[el.id] ?? []).flatMap((r) =>
          r.recordId !== row.recordId ? [r] : r.isNew ? [] : [{ ...r, deleted: true }],
        ),
      },
    }));
  };

  return (
    <div className={`subform-section${error ? " has-error" : ""}`}>
      <div className="subform-title">
        {el.label}
        <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
          {children.length} row{children.length !== 1 ? "s" : ""}
        </span>
      </div>
      {el.description && <div className="field-help">{el.description}</div>}
      <HierarchyRows
        rows={children}
        needsAttention={(r) => !!r.node.isNew || !!r.node.notice || [...ctx.errors.keys()].some((k) => subtreeIds(r).has(k.split(":")[0]))}
        renderRow={(child, i) => (
          <SubformRow key={child.node.recordId} tree={child} index={i} ctx={ctx} onRemove={() => removeRow(child.node)} />
        )}
      />
      {error && <div className="field-error">{error}</div>}
      <button type="button" className="btn btn-sm" onClick={addRow} disabled={ctx.disabled} style={{ marginTop: 8 }}>
        + Add row
      </button>
    </div>
  );
}

function SubformRow({ tree, index, ctx, onRemove }: { tree: ScopeTree; index: number; ctx: Ctx; onRemove: () => void }) {
  const [open, setOpen] = useState(!!tree.node.isNew);
  const ids = subtreeIds(tree);
  const hasError = [...ctx.errors.keys()].some((k) => ids.has(k.split(":")[0]));
  const rowError = ctx.errors.get(errKey(tree.node.recordId, ROW_ERR));
  const expanded = open || hasError;
  return (
    <div className={`subform-record${hasError ? " has-error" : ""}`}>
      <div className="subform-row-head">
        <button type="button" className="link-btn row-toggle" onClick={() => setOpen(!expanded)}>
          {expanded ? "▾" : "▸"} {rowTitle(tree, index)}
        </button>
        <button type="button" className="btn btn-sm btn-danger-outline" onClick={onRemove} disabled={ctx.disabled}>
          Remove
        </button>
      </div>
      {tree.node.notice && <div className="row-notice">{tree.node.notice}</div>}
      {rowError && <div className="field-error">{rowError}</div>}
      {expanded && (
        <div className="subform-row-body">
          <Fields tree={tree} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
