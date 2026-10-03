import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Grant, RecordChange } from "../lib/api.js";
import { generateRecordId } from "../lib/cuid.js";
import { defaultFields, loadFormStore, loadRecordTree } from "../lib/formStore.js";
import { migrateLocationMethod } from "../lib/portalRules.js";
import type { RecordNode } from "../lib/formStore.js";
import type { FormStore } from "../lib/scope.js";
import { SchemaForm } from "../components/SchemaForm.js";

export function RecordEditPage() {
  const { formId, recordId } = useParams<{ formId: string; recordId: string }>();
  const navigate = useNavigate();
  const isNew = !recordId;

  const [store, setStore] = useState<FormStore | null>(null);
  const [root, setRoot] = useState<RecordNode | null>(null);
  const [parentRecordId, setParentRecordId] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!formId) return;
    let cancelled = false;
    (async () => {
      try {
        const [st, rec] = await Promise.all([
          loadFormStore(formId),
          isNew ? null : api.getRecord(formId, recordId!),
        ]);
        const schema = st.schemas.get(formId);
        if (!schema) throw new Error("Form not found or not accessible.");
        api.getGrants(schema.databaseId)
          .then((g) => { if (!cancelled) setGrants(g.grants); })
          .catch(() => {});
        let node: RecordNode;
        if (!rec) {
          node = { formId, recordId: generateRecordId(), fields: defaultFields(schema), subforms: {}, isNew: true, dirty: true };
        } else {
          node = await loadRecordTree(st, formId, rec.recordId, rec.fields ?? {});
          migrateLocationMethod(node, st);
          if (!cancelled) setParentRecordId(rec.parentRecordId ?? null);
        }
        if (cancelled) return;
        setStore(st);
        setRoot(node);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => { cancelled = true; };
  }, [formId, recordId, isNew]);

  if (error) return <div className="error-msg">{error}</div>;
  if (!store || !root || !formId) return <div className="loading">Loading form and its lists…</div>;
  const schema = store.schemas.get(formId)!;

  const handleSubmit = async (changes: RecordChange[]) => {
    await api.saveChanges(changes);
    navigate(`/form/${formId}/record/${root.recordId}`);
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
        <span>{isNew ? "New Record" : "Edit Record"}</span>
      </div>
      <h2 className="page-title">{isNew ? `New ${schema.label}` : `Edit ${schema.label}`}</h2>
      <div className="card">
        <SchemaForm
          store={store}
          initial={root}
          parentRecordId={parentRecordId}
          grants={grants}
          onSubmit={handleSubmit}
          submitLabel={isNew ? "Create Record" : "Save Changes"}
        />
      </div>
    </>
  );
}
