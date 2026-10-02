import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { loadFormStore, loadRecordTree } from "../lib/formStore.js";
import type { RecordNode } from "../lib/formStore.js";
import { buildScopeTree } from "../lib/formLogic.js";
import type { FormStore } from "../lib/scope.js";
import { RecordView } from "../components/RecordView.js";
import { ExpandAll } from "../components/expandAll.js";

export function RecordViewPage() {
  const { formId, recordId } = useParams<{ formId: string; recordId: string }>();
  const navigate = useNavigate();
  const [store, setStore] = useState<FormStore | null>(null);
  const [root, setRoot] = useState<RecordNode | null>(null);
  const [lastEdit, setLastEdit] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [browserPrint, setBrowserPrint] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!formId || !recordId) return;
    let cancelled = false;
    (async () => {
      try {
        const [st, rec] = await Promise.all([loadFormStore(formId), api.getRecord(formId, recordId)]);
        const node = await loadRecordTree(st, formId, recordId, rec.fields ?? {});
        if (cancelled) return;
        setStore(st);
        setRoot(node);
        setLastEdit(rec.lastEditTime);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => { cancelled = true; };
  }, [formId, recordId]);

  useEffect(() => {
    if (!printing) return;
    const previous = document.title;
    if (store && root) {
      const schema = store.schemas.get(root.formId);
      const titleEl = schema?.elements.find((e) => e.type === "FREE_TEXT" && root.fields[e.id]);
      const title = titleEl ? String(root.fields[titleEl.id]) : root.recordId;
      document.title = `${title} - ${schema?.label ?? "Record"}`.replace(/[\\/:*?"<>|]/g, "-");
    }
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    // Give the expanded rows a moment to render before opening the print window.
    const timer = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
      document.title = previous;
    };
  }, [printing, store, root]);

  useEffect(() => {
    // Ctrl+P or the browser's Print menu: open every row before the page is captured.
    const before = () => flushSync(() => setBrowserPrint(true));
    const after = () => setBrowserPrint(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  if (error) return <div className="error-msg">{error}</div>;
  if (!store || !root || !formId || !recordId) return <div className="loading">Loading record…</div>;
  const schema = store.schemas.get(formId)!;

  const onDelete = async () => {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteRecord(formId, recordId);
      navigate(`/form/${formId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Databases</Link>
        <span>/</span>
        <Link to={`/db/${schema.databaseId}`}>Database</Link>
        <span>/</span>
        <Link to={`/form/${formId}`}>{schema.label}</Link>
        <span>/</span>
        <span>Record</span>
      </div>
      <div className="title-row">
        <h2 className="page-title">{schema.label}</h2>
        <div className="no-print" style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={printing} onClick={() => setPrinting(true)}>
            {printing ? "Preparing…" : "Export to PDF"}
          </button>
          <Link to={`/form/${formId}/record/${recordId}/edit`} className="btn btn-primary">Edit</Link>
          <button className="btn btn-danger-outline" disabled={deleting} onClick={onDelete}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Record ID: {recordId}
        {lastEdit > 0 && <> · Last edited: {new Date(lastEdit * 1000).toLocaleString()}</>}
      </p>
      <p className="print-only muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Exported from ActivityInfo Portal on {new Date().toLocaleString()}. Please verify all entries in ActivityInfo.
      </p>
      <div className="card">
        <ExpandAll.Provider value={printing || browserPrint}>
          <RecordView tree={buildScopeTree(root, store)} />
        </ExpandAll.Provider>
      </div>
    </>
  );
}
