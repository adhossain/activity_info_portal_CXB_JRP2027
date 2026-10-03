import { useContext, useState } from "react";
import type { ReactNode } from "react";
import { hierarchyField, lookupLevels } from "../lib/formLogic.js";
import type { ScopeTree } from "../lib/formLogic.js";
import { refList } from "../lib/scope.js";
import { ExpandAll } from "./expandAll.js";

export interface Group {
  kind: string;
  value: string;
  groups: Group[];
  rows: ScopeTree[];
}

export function countRows(g: Group): number {
  return g.rows.length + g.groups.reduce((s, c) => s + countRows(c), 0);
}

function allRows(g: Group): ScopeTree[] {
  return [...g.rows, ...g.groups.flatMap(allRows)];
}

/**
 * Groups sub-form rows by all lookup levels but the last, e.g. Objective → Activity Group,
 * leaving each row (the Sub-Activity) inside its group. Rows not yet chosen stay ungrouped.
 */
export function groupRows(rows: ScopeTree[]): { groups: Group[]; ungrouped: ScopeTree[] } | undefined {
  const el = rows[0] && hierarchyField(rows[0].schema);
  if (!el) return undefined;
  const groups: Group[] = [];
  const ungrouped: ScopeTree[] = [];
  for (const r of rows) {
    const levels = lookupLevels(el, refList(r.node.fields[el.id])[0], r.scope.store);
    if (!levels || levels.length < 2 || levels.some((l) => !l.value)) {
      ungrouped.push(r);
      continue;
    }
    let list = groups;
    let target: Group | undefined;
    for (const l of levels.slice(0, -1)) {
      target = list.find((g) => g.value === l.value);
      if (!target) {
        target = { kind: l.label, value: l.value, groups: [], rows: [] };
        list.push(target);
      }
      list = target.groups;
    }
    target!.rows.push(r);
  }
  return { groups, ungrouped };
}

/**
 * Renders sub-form rows nested by their lookup levels (Objective → Activity Group → rows),
 * or as a flat list when the sub-form has no such hierarchy.
 */
export function HierarchyRows({
  rows,
  renderRow,
  needsAttention,
}: {
  rows: ScopeTree[];
  renderRow: (row: ScopeTree, index: number) => ReactNode;
  /** Groups holding such rows open by themselves (new rows, rows with errors). */
  needsAttention?: (row: ScopeTree) => boolean;
}) {
  const grouped = groupRows(rows);
  const indexOf = (r: ScopeTree) => rows.indexOf(r);
  if (!grouped) return <>{rows.map((r) => renderRow(r, indexOf(r)))}</>;
  return (
    <>
      {grouped.groups.map((g) => (
        <GroupRow key={g.value} group={g} depth={0} renderRow={(r) => renderRow(r, indexOf(r))} needsAttention={needsAttention} />
      ))}
      {grouped.ungrouped.map((r) => renderRow(r, indexOf(r)))}
    </>
  );
}

function GroupRow({
  group,
  depth,
  renderRow,
  needsAttention,
}: {
  group: Group;
  depth: number;
  renderRow: (row: ScopeTree) => ReactNode;
  needsAttention?: (row: ScopeTree) => boolean;
}) {
  const [open, setOpen] = useState(depth > 0);
  const expandAll = useContext(ExpandAll);
  const forced = expandAll || (!!needsAttention && allRows(group).some(needsAttention));
  const expanded = open || forced;
  const n = countRows(group);
  const detail = [
    group.groups.length ? `${group.groups.length} ${group.groups[0].kind.toLowerCase()}${group.groups.length > 1 ? "s" : ""}` : "",
    `${n} activit${n > 1 ? "ies" : "y"}`,
  ].filter(Boolean).join(", ");
  return (
    <div className={`subform-record group-row group-depth-${depth}`}>
      <button type="button" className="link-btn row-toggle" onClick={() => setOpen(!expanded)}>
        {expanded ? "▾" : "▸"} <span className="group-kind">{group.kind}</span> {group.value}
        <span className="group-count">{detail}</span>
      </button>
      {expanded && (
        <div className="group-body">
          {group.groups.map((g) => (
            <GroupRow key={g.value} group={g} depth={depth + 1} renderRow={renderRow} needsAttention={needsAttention} />
          ))}
          {group.rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}
