import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import type { Database } from "../lib/api.js";
import { FEATURED_DATABASES } from "../lib/featured.js";

export function DatabasesPage() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getDatabases()
      .then((all) => setDatabases(all.filter((db) => FEATURED_DATABASES.has(db.databaseId))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading databases…</div>;
  if (error) return <div className="error-msg">{error}</div>;

  return (
    <>
      <h2 className="page-title">Databases</h2>
      {databases.length === 0 ? (
        <div className="empty">
          The Bangladesh Rohingya Refugees Joint Response Plan database is not available to your ActivityInfo account.
        </div>
      ) : (
        <div className="grid">
          {databases.map((db) => (
            <Link
              key={db.databaseId}
              to={`/db/${db.databaseId}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                className={`card${FEATURED_DATABASES.has(db.databaseId) ? " card-featured" : ""}`}
                style={{ cursor: "pointer" }}
              >
                {FEATURED_DATABASES.has(db.databaseId) && <span className="featured-tag">JRP 2027-28</span>}
                <div className="card-title">{db.label}</div>
                {db.description && (
                  <div className="card-desc">{db.description}</div>
                )}
                {db.suspended && (
                  <span className="badge badge-required" style={{ marginTop: 8 }}>
                    Suspended
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
