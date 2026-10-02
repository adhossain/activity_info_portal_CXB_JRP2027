import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { FormElement, FormSchema } from "../lib/api.js";
import { loadSchema } from "../lib/formStore.js";
import { isRefType, recordLabel, refTargets } from "../lib/scope.js";
import type { FlatRow } from "../lib/scope.js";

const MAX_COLUMNS = 7;
const HIDDEN_TYPES = new Set(["section", "subform", "note", "reversereference", "NARRATIVE", "attachment", "geopoint"]);

/** ActivityInfo's flat query names columns by code, or label when there is no code. */
const columnKey = (el: FormElement) => el.code || el.label;

export function RecordsPage() {
  const { formId } = useParams<{ formId: string }>();
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [targets, setTargets] = useState<Map<string, FormSchema>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!formId) return;
    let cancelled = false;
    (async () => {
      try {
        const [res, s] = await Promise.all([api.getFormRecords(formId), loadSchema(formId)]);
        const refIds = [...new Set(s.elements.filter((e) => isRefType(e.type)).flatMap(refTargets))];
        const refSchemas = await Promise.all(refIds.map((id) => loadSchema(id).catch(() => null)));
        if (cancelled) return;
        setRows(res.rows);
        setSchema(s);
        setTargets(new Map(refSchemas.filter((x): x is FormSchema => !!x).map((x) => [x.id, x])));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formId]);

  if (loading) return <div className="loading">Loading records…</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!formId || !schema) return null;

  const columns = schema.elements
    .filter((el) => !HIDDEN_TYPES.has(el.type) && el.tableVisible !== false && el.dataEntryVisible !== false)
    .slice(0, MAX_COLUMNS);

  const cell = (el: FormElement, row: FlatRow): string => {
    const key = columnKey(el);
    if (isRefType(el.type)) {
      const prefix = key + ".";
      const sub: FlatRow = {};
      for (const [k, v] of Object.entries(row)) if (k.startsWith(prefix)) sub[k.slice(prefix.length)] = v;
      if (sub["@id"] == null) return "";
      return recordLabel(targets.get(refTargets(el)[0]), sub);
    }
    const v = row[key];
    if (v == null) return "";
    if (typeof v === "number") return v.toLocaleString();
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Databases</Link>
        <span>/</span>
        <Link to={`/db/${schema.databaseId}`}>Database</Link>
        <span>/</span>
        <span>{schema.label}</span>
      </div>
      <div className="title-row">
        <h2 className="page-title">{schema.label}</h2>
        <Link to={`/form/${formId}/new`} className="btn btn-primary">
          + New Record
        </Link>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
        {rows.length} record{rows.length !== 1 ? "s" : ""}
      </p>

      {rows.length === 0 ? (
        <div className="empty">No records found.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                {columns.map((el) => <th key={el.id}>{el.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const recId = String(row["@id"] ?? i);
                return (
                  <tr key={recId}>
                    <td>
                      <Link to={`/form/${formId}/record/${recId}`} className="btn btn-sm btn-view">
                        View
                      </Link>
                    </td>
                    {columns.map((el) => {
                      const text = cell(el, row);
                      return (
                        <td key={el.id} title={text.length > 80 ? text : undefined}>
                          {text ? (text.length > 80 ? text.slice(0, 77) + "…" : text) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
