import { useContext, useState } from "react";
import { toText } from "../lib/formula.js";
import { calcValue, computeVisibility, lookupLevels } from "../lib/formLogic.js";
import type { ScopeTree } from "../lib/formLogic.js";
import { formatValue, refList } from "../lib/scope.js";
import { HierarchyRows } from "./HierarchyOverview.js";
import { ExpandAll } from "./expandAll.js";
import { rowTitle, SectionHeader } from "./SchemaForm.js";

function FieldView({ label, text }: { label: string; text: string }) {
  return (
    <div className="field-view">
      <div className="field-label">{label}</div>
      <div className={`field-value${text ? "" : " empty-val"}`}>{text || "—"}</div>
    </div>
  );
}

export function RecordView({ tree }: { tree: ScopeTree }) {
  const { schema, scope, node } = tree;
  const vis = computeVisibility(schema, scope);
  return (
    <>
      {schema.elements.map((el) => {
        if (!vis.shown.has(el.id)) return null;
        if (el.type === "section") return <SectionHeader key={el.id} el={el} />;
        if (el.type === "note" || el.type === "reversereference") return null;
        if (el.type === "subform") {
          const rows = tree.children[el.id] ?? [];
          return (
            <div key={el.id} className="subform-section">
              <div className="subform-title">
                {el.label}
                <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  {rows.length} row{rows.length !== 1 ? "s" : ""}
                </span>
              </div>
              {rows.length === 0 && <div className="field-help">No rows.</div>}
              <HierarchyRows rows={rows} renderRow={(r, i) => <ViewRow key={r.node.recordId} tree={r} index={i} />} />
            </div>
          );
        }
        if (el.type === "calculated") {
          const v = calcValue(el, scope);
          return <FieldView key={el.id} label={el.label} text={v == null ? "" : toText(v)} />;
        }
        const levels = el.type === "reference" ? lookupLevels(el, refList(node.fields[el.id])[0], scope.store) : undefined;
        if (levels && levels.length > 1) {
          return (
            <div key={el.id} className="lookup-view">
              <div className="field-label">{el.label}</div>
              {/* Activity rows sit under their objective's row, so the objective is not repeated. */}
              {(scope.parent ? levels.slice(1) : levels).map((l) => (
                <FieldView key={l.label} label={l.label} text={l.value} />
              ))}
            </div>
          );
        }
        return <FieldView key={el.id} label={el.label} text={formatValue(el, node.fields[el.id], scope.store)} />;
      })}
    </>
  );
}

function ViewRow({ tree, index }: { tree: ScopeTree; index: number }) {
  const [isOpen, setOpen] = useState(false);
  const expandAll = useContext(ExpandAll);
  const open = isOpen || expandAll;
  return (
    <div className="subform-record">
      <button type="button" className="link-btn row-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {rowTitle(tree, index)}
      </button>
      {open && <div className="subform-row-body"><RecordView tree={tree} /></div>}
    </div>
  );
}
