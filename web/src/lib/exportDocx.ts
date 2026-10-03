import type { Paragraph as ParagraphT } from "docx";
import type { FormElement } from "./api.js";
import { toText } from "./formula.js";
import { calcValue, computeVisibility, lookupLevels } from "./formLogic.js";
import type { ScopeTree } from "./formLogic.js";
import { formatValue, refList } from "./scope.js";
import { countRows, groupRows } from "../components/HierarchyOverview.js";
import type { Group } from "../components/HierarchyOverview.js";
import { rowTitle } from "../components/SchemaForm.js";

/** Same palette as the web page. */
const C = { text: "1A1A2E", muted: "6C757D", primary: "0066CC", primaryLight: "7FB2E5", border: "DEE2E6" };
const INDENT = 360; // twips per nesting level (0.25")

export interface DocxMeta {
  title: string;
  recordLine: string;
  exportedLine: string;
  fileName: string;
}

/** Builds a Word document of the record (every row included) and downloads it. */
export async function exportDocx(tree: ScopeTree, meta: DocxMeta): Promise<void> {
  const d = await import("docx");
  const { Paragraph, TextRun, HeadingLevel, BorderStyle, AlignmentType, Footer, PageNumber } = d;
  const out: ParagraphT[] = [];

  /** One paragraph per line of the text; blank lines keep paragraph breaks. */
  const textParagraphs = (text: string, level: number, run: Record<string, unknown> = {}) =>
    text.split(/\r?\n/).map(
      (line) =>
        new Paragraph({
          indent: { left: level * INDENT },
          spacing: { after: 40 },
          children: [new TextRun({ text: line, ...run })],
        }),
    );

  const field = (label: string, text: string, level: number) => {
    out.push(
      new Paragraph({
        indent: { left: level * INDENT },
        spacing: { before: 120, after: 20 },
        keepNext: true,
        children: [new TextRun({ text: label, bold: true, allCaps: true, size: 16, color: C.muted })],
      }),
    );
    if (text) out.push(...textParagraphs(text, level));
    else out.push(...textParagraphs("—", level, { italics: true, color: C.muted }));
  };

  const sectionHeading = (el: FormElement, level: number) => {
    const depth = (el.typeParameters?.indentationLevel ?? 1) + (level > 0 ? 1 : 0);
    const heading = depth <= 1 ? HeadingLevel.HEADING_1 : depth === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    out.push(
      new Paragraph({
        heading,
        indent: { left: level * INDENT },
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: depth <= 1 ? 12 : 6, color: C.primary, space: 2 } },
        children: [new TextRun({ text: el.label })],
      }),
    );
    if (el.description) out.push(...textParagraphs(el.description, level, { size: 18, color: C.muted }));
  };

  const rowHeading = (text: string, level: number, kind?: string, detail?: string, color = C.border) => {
    out.push(
      new Paragraph({
        indent: { left: level * INDENT },
        spacing: { before: 200, after: 60 },
        keepNext: true,
        border: { left: { style: BorderStyle.SINGLE, size: 18, color, space: 6 } },
        children: [
          ...(kind ? [new TextRun({ text: `${kind}  `, bold: true, allCaps: true, size: 16, color: C.primary })] : []),
          new TextRun({ text, bold: true }),
          ...(detail ? [new TextRun({ text: `   ${detail}`, size: 17, color: C.muted })] : []),
        ],
      }),
    );
  };

  const renderRecord = (t: ScopeTree, level: number) => {
    const { schema, scope, node } = t;
    const vis = computeVisibility(schema, scope);
    for (const el of schema.elements) {
      if (!vis.shown.has(el.id)) continue;
      if (el.type === "section") sectionHeading(el, level);
      else if (el.type === "note" || el.type === "reversereference") continue;
      else if (el.type === "subform") renderSubform(el, t.children[el.id] ?? [], level);
      else if (el.type === "calculated") {
        const v = calcValue(el, scope);
        field(el.label, v == null ? "" : toText(v), level);
      } else {
        const levels = el.type === "reference" ? lookupLevels(el, refList(node.fields[el.id])[0], scope.store) : undefined;
        if (levels && levels.length > 1) {
          // As on screen: rows sit under their objective, so the objective is not repeated there.
          for (const l of scope.parent ? levels.slice(1) : levels) field(l.label, l.value, level);
        } else {
          field(el.label, formatValue(el, node.fields[el.id], scope.store), level);
        }
      }
    }
  };

  const renderRow = (r: ScopeTree, index: number, level: number) => {
    rowHeading(rowTitle(r, index), level);
    renderRecord(r, level + 1);
  };

  const renderGroup = (g: Group, rows: ScopeTree[], level: number) => {
    const n = countRows(g);
    const detail = [
      g.groups.length ? `${g.groups.length} ${g.groups[0].kind.toLowerCase()}${g.groups.length > 1 ? "s" : ""}` : "",
      `${n} activit${n > 1 ? "ies" : "y"}`,
    ].filter(Boolean).join(", ");
    rowHeading(g.value, level, g.kind, detail, level === 0 ? C.primary : C.primaryLight);
    for (const sub of g.groups) renderGroup(sub, rows, level + 1);
    for (const r of g.rows) renderRow(r, rows.indexOf(r), level + 1);
  };

  function renderSubform(el: FormElement, rows: ScopeTree[], level: number) {
    out.push(
      new Paragraph({
        heading: level === 0 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        indent: { left: level * INDENT },
        keepNext: true,
        children: [
          new TextRun({ text: el.label }),
          new TextRun({ text: `   ${rows.length} row${rows.length !== 1 ? "s" : ""}`, size: 18, bold: false, color: C.muted }),
        ],
      }),
    );
    if (rows.length === 0) {
      out.push(...textParagraphs("No rows.", level, { italics: true, color: C.muted }));
      return;
    }
    const grouped = groupRows(rows);
    if (grouped) {
      for (const g of grouped.groups) renderGroup(g, rows, level);
      for (const r of grouped.ungrouped) renderRow(r, rows.indexOf(r), level);
    } else {
      rows.forEach((r, i) => renderRow(r, i, level));
    }
  }

  out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: meta.title })] }));
  out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: meta.recordLine, size: 18, color: C.muted })] }));
  out.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: meta.exportedLine, size: 18, italics: true, color: C.muted })] }));
  renderRecord(tree, 0);

  const doc = new d.Document({
    creator: "ActivityInfo Portal",
    title: meta.title,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21, color: C.text } },
        title: { run: { font: "Calibri", size: 36, bold: true, color: C.text }, paragraph: { spacing: { after: 80 } } },
        heading1: { run: { font: "Calibri", size: 28, bold: true, color: C.text }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading2: { run: { font: "Calibri", size: 24, bold: true, color: C.text }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading3: { run: { font: "Calibri", size: 22, bold: true, color: C.text }, paragraph: { spacing: { before: 200, after: 80 } } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: C.muted }),
                ],
              }),
            ],
          }),
        },
        children: out,
      },
    ],
  });

  const blob = await d.Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meta.fileName}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
