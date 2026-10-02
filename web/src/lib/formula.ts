export type Val = string | number | boolean | null | Val[];

/** Thrown when a formula refers to something we cannot resolve; callers fail open. */
export class Unknown extends Error {}

export interface Resolver {
  resolve(path: string[]): Val;
}

type Node =
  | { k: "lit"; v: Val }
  | { k: "ref"; path: string[] }
  | { k: "un"; op: "!" | "-"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

const OPS = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "!", "+", "-", "*", "/", "(", ")", ",", ".", "="];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && (src[j + 1] === c || src[j + 1] === "\\")) j++;
        s += src[j++];
      }
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Unknown("unclosed [");
      out.push({ t: "id", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_@$]/.test(c)) {
      const m = /^[A-Za-z_@$][A-Za-z0-9_@$]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Unknown(`bad character ${c}`);
    out.push({ t: "op", v: op === "=" ? "==" : op });
    i += op.length;
  }
  return out;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  parse(): Node {
    const n = this.or();
    if (this.p < this.toks.length) throw new Unknown("trailing tokens");
    return n;
  }
  private peekOp(...ops: string[]) {
    const t = this.toks[this.p];
    return t && t.t === "op" && ops.includes(t.v) ? t.v : null;
  }
  private expectOp(op: string) {
    if (!this.peekOp(op)) throw new Unknown(`expected ${op}`);
    this.p++;
  }
  private bin(next: () => Node, ops: string[]): Node {
    let a = next();
    for (let op = this.peekOp(...ops); op; op = this.peekOp(...ops)) {
      this.p++;
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  }
  private or = (): Node => this.bin(this.and, ["||"]);
  private and = (): Node => this.bin(this.eq, ["&&"]);
  private eq = (): Node => this.bin(this.cmp, ["==", "!="]);
  private cmp = (): Node => this.bin(this.add, ["<", "<=", ">", ">="]);
  private add = (): Node => this.bin(this.mul, ["+", "-"]);
  private mul = (): Node => this.bin(this.unary, ["*", "/"]);
  private unary = (): Node => {
    const op = this.peekOp("!", "-");
    if (op) {
      this.p++;
      return { k: "un", op: op as "!" | "-", a: this.unary() };
    }
    return this.primary();
  };
  private primary(): Node {
    const t = this.toks[this.p++];
    if (!t) throw new Unknown("unexpected end");
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const n = this.or();
      this.expectOp(")");
      return n;
    }
    if (t.t === "id") {
      const up = t.v.toUpperCase();
      if (this.peekOp("(")) {
        this.p++;
        const args: Node[] = [];
        if (!this.peekOp(")")) {
          args.push(this.or());
          while (this.peekOp(",")) { this.p++; args.push(this.or()); }
        }
        this.expectOp(")");
        return { k: "call", fn: up, args };
      }
      if (up === "TRUE" || up === "FALSE") return { k: "lit", v: up === "TRUE" };
      const path = [t.v];
      while (this.peekOp(".")) {
        this.p++;
        const n = this.toks[this.p++];
        if (!n || n.t !== "id") throw new Unknown("expected field after .");
        path.push(n.v);
      }
      return { k: "ref", path };
    }
    throw new Unknown("unexpected token");
  }
}

const cache = new Map<string, Node | Unknown>();

function parse(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    try {
      n = new Parser(tokenize(src)).parse();
    } catch (e) {
      n = e instanceof Unknown ? e : new Unknown(String(e));
    }
    cache.set(src, n);
  }
  if (n instanceof Unknown) throw n;
  return n;
}

export function isBlank(v: Val): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.every(isBlank));
}

export function truthy(v: Val): boolean {
  if (Array.isArray(v)) return v.some(truthy);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v !== "";
  return false;
}

function flat(vals: Val[]): Val[] {
  return vals.flatMap((v) => (Array.isArray(v) ? flat(v) : [v]));
}

function num(v: Val): number | null {
  if (Array.isArray(v)) return v.length === 1 ? num(v[0]) : null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: Val): string {
  if (v === null) return "";
  if (Array.isArray(v)) return flat(v).map(str).filter(Boolean).join(", ");
  return String(v);
}

function eq(a: Val, b: Val): boolean {
  if (Array.isArray(a)) return a.some((x) => eq(x, b));
  if (Array.isArray(b)) return b.some((x) => eq(a, x));
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  if (typeof a === "number" || typeof b === "number") {
    const x = num(a), y = num(b);
    return x !== null && y !== null && x === y;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return truthy(a) === truthy(b);
  return String(a) === String(b);
}

function cmp(op: string, a: Val, b: Val): boolean {
  if (isBlank(a) || isBlank(b)) return false;
  const x = num(a), y = num(b);
  let c: number;
  if (x !== null && y !== null) c = x - y;
  else c = str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0;
  return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
}

function arith(op: string, a: Val, b: Val): Val {
  const x = num(a), y = num(b);
  if (op === "+" && ((x === null && !isBlank(a)) || (y === null && !isBlank(b)))) return str(a) + str(b);
  const l = x ?? 0, r = y ?? 0;
  if (op === "+") return l + r;
  if (op === "-") return l - r;
  if (op === "*") return l * r;
  return r === 0 ? null : l / r;
}

function regex(v: Val): RegExp {
  try {
    return new RegExp(str(v));
  } catch {
    throw new Unknown("bad regular expression");
  }
}

function call(fn: string, args: Node[], r: Resolver): Val {
  const ev = (n: Node) => evalNode(n, r);
  switch (fn) {
    case "IF": {
      if (args.length < 2) throw new Unknown("IF arity");
      return truthy(ev(args[0])) ? ev(args[1]) : args[2] ? ev(args[2]) : null;
    }
    case "ISBLANK": return isBlank(ev(args[0]));
    case "ISNUMBER": return num(ev(args[0])) !== null;
    case "CONCAT": return args.map((a) => str(ev(a))).join("");
    case "SEARCH": {
      const needle = str(ev(args[0])).toLowerCase();
      const hay = str(ev(args[1])).toLowerCase();
      const start = args[2] ? Math.max(1, num(ev(args[2])) ?? 1) : 1;
      return hay.indexOf(needle, start - 1) + 1;
    }
    case "LEFT": return str(ev(args[0])).slice(0, args[1] ? num(ev(args[1])) ?? 1 : 1);
    case "RIGHT": {
      const s = str(ev(args[0]));
      const n = args[1] ? num(ev(args[1])) ?? 1 : 1;
      return n <= 0 ? "" : s.slice(-n);
    }
    case "MID": {
      const start = Math.max(1, num(ev(args[1])) ?? 1);
      return str(ev(args[0])).substr(start - 1, num(ev(args[2])) ?? 0);
    }
    case "REGEXMATCH": return regex(ev(args[1])).test(str(ev(args[0])));
    case "REGEXEXTRACT": {
      const m = regex(ev(args[1])).exec(str(ev(args[0])));
      return m ? (m[1] ?? m[0]) : null;
    }
    case "REGEXREPLACE": return str(ev(args[0])).replace(new RegExp(regex(ev(args[1])).source, "g"), str(ev(args[2])));
    case "LOWER": return str(ev(args[0])).toLowerCase();
    case "UPPER": return str(ev(args[0])).toUpperCase();
    case "TRIM": return str(ev(args[0])).trim();
    case "LEN": return str(ev(args[0])).length;
    case "TEXT": return str(ev(args[0]));
    case "VALUE": return num(ev(args[0]));
    case "FLOOR": { const v = num(ev(args[0])); return v === null ? null : Math.floor(v); }
    case "CEIL": { const v = num(ev(args[0])); return v === null ? null : Math.ceil(v); }
    case "ABS": { const v = num(ev(args[0])); return v === null ? null : Math.abs(v); }
    case "ROUND": {
      const v = num(ev(args[0]));
      const d = args[1] ? num(ev(args[1])) ?? 0 : 0;
      return v === null ? null : Math.round(v * 10 ** d) / 10 ** d;
    }
    case "SUM": case "MAX": case "MIN": case "AVERAGE": case "MEAN": {
      const ns = flat(args.map(ev)).map(num).filter((x): x is number => x !== null);
      if (fn === "SUM") return ns.reduce((s, x) => s + x, 0);
      if (ns.length === 0) return null;
      if (fn === "MAX") return Math.max(...ns);
      if (fn === "MIN") return Math.min(...ns);
      return ns.reduce((s, x) => s + x, 0) / ns.length;
    }
    case "COUNT": return flat(args.map(ev)).filter((v) => !isBlank(v)).length;
    case "COUNTDISTINCT":
      return new Set(flat(args.map(ev)).filter((v) => !isBlank(v)).map(str)).size;
    default:
      throw new Unknown(`function ${fn}`);
  }
}

function evalNode(n: Node, r: Resolver): Val {
  switch (n.k) {
    case "lit": return n.v;
    case "ref": return r.resolve(n.path);
    case "un": {
      const v = evalNode(n.a, r);
      return n.op === "!" ? !truthy(v) : -(num(v) ?? 0);
    }
    case "bin": {
      if (n.op === "||") return truthy(evalNode(n.a, r)) || truthy(evalNode(n.b, r));
      if (n.op === "&&") return truthy(evalNode(n.a, r)) && truthy(evalNode(n.b, r));
      const a = evalNode(n.a, r), b = evalNode(n.b, r);
      if (n.op === "==") return eq(a, b);
      if (n.op === "!=") return !eq(a, b);
      if (["<", "<=", ">", ">="].includes(n.op)) return cmp(n.op, a, b);
      return arith(n.op, a, b);
    }
    case "call": return call(n.fn, n.args, r);
  }
}

/** Evaluates a formula; throws Unknown if it cannot be resolved. */
export function evaluate(src: string, r: Resolver): Val {
  return evalNode(parse(src), r);
}

/** Evaluates a formula; returns undefined when the result cannot be determined. */
export function tryEval(src: string, r: Resolver): Val | undefined {
  try {
    return evaluate(src, r);
  } catch (e) {
    if (e instanceof Unknown) return undefined;
    throw e;
  }
}

export function toText(v: Val): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return str(v);
}
