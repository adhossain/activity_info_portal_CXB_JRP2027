import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { DatabaseTree, Resource, Grant } from "../lib/api.js";
import { FEATURED_FORMS } from "../lib/featured.js";

export function FormsPage() {
  const { databaseId } = useParams<{ databaseId: string }>();
  const [tree, setTree] = useState<DatabaseTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!databaseId) return;
    api
      .getDatabaseTree(databaseId)
      .then(setTree)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [databaseId]);

  if (loading) return <div className="loading">Loading forms…</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!tree) return null;

  const grants = tree.grants ?? [];
  const grantedIds = new Set(grants.map((g) => g.resourceId));

  const allForms = tree.resources.filter((r) => r.type === "FORM");
  const folders = tree.resources.filter((r) => r.type === "FOLDER");

  const forms = filterAccessibleForms(allForms, folders, grants, grantedIds).filter((f) => FEATURED_FORMS.has(f.id));

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Databases</Link>
        <span>/</span>
        <span>{tree.label}</span>
      </div>
      <h2 className="page-title">{tree.label}</h2>
      {tree.description && (
        <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
          {tree.description}
        </p>
      )}

      {forms.length === 0 ? (
        <div className="empty">The JRP 2027-28 Project Submission form is not available to your ActivityInfo account in this database.</div>
      ) : (
        <FormTree forms={forms} folders={folders} />
      )}
    </>
  );
}

function filterAccessibleForms(
  forms: Resource[],
  folders: Resource[],
  grants: Grant[],
  grantedIds: Set<string>,
): Resource[] {
  if (grants.length === 0) return forms;

  const grantedFolderIds = new Set(
    folders.filter((f) => grantedIds.has(f.id)).map((f) => f.id),
  );

  return forms.filter((f) => {
    if (grantedIds.has(f.id)) return true;
    if (grantedFolderIds.has(f.parentId)) return true;
    if (f.visibility === "REFERENCE") return false;
    return false;
  });
}

function FormTree({
  forms,
  folders,
}: {
  forms: Resource[];
  folders: Resource[];
}) {
  const folderMap = new Map<string, Resource[]>();
  const rootForms: Resource[] = [];

  for (const form of forms) {
    const parent = folders.find((f) => f.id === form.parentId);
    if (parent) {
      const list = folderMap.get(parent.id) ?? [];
      list.push(form);
      folderMap.set(parent.id, list);
    } else {
      rootForms.push(form);
    }
  }

  return (
    <>
      {rootForms.length > 0 && (
        <div className="grid">
          {rootForms.map((f) => (
            <FormCard key={f.id} form={f} />
          ))}
        </div>
      )}

      {folders.map((folder) => {
        const children = folderMap.get(folder.id);
        if (!children?.length) return null;
        return (
          <div key={folder.id} style={{ marginTop: 16 }}>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              {folder.label}
            </h3>
            <div className="grid">
              {children.map((f) => (
                <FormCard key={f.id} form={f} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function FormCard({ form }: { form: Resource }) {
  return (
    <Link
      to={`/form/${form.id}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div
        className={`card${FEATURED_FORMS.has(form.id) ? " card-featured" : ""}`}
        style={{ cursor: "pointer" }}
      >
        {FEATURED_FORMS.has(form.id) && <span className="featured-tag">Project submission</span>}
        <div className="card-title">{form.label}</div>
      </div>
    </Link>
  );
}
