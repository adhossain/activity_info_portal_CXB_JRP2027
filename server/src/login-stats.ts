import { readFile } from "node:fs/promises";
import { LOGIN_LOG } from "./login-log.js";

const text = await readFile(LOGIN_LOG, "utf8").catch(() => "");
const entries = text
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const e = JSON.parse(line) as { at: string; email?: string; user?: string };
    return { at: e.at, user: e.email ?? e.user ?? "unknown" };
  });

if (entries.length === 0) {
  console.log("No logins recorded yet.");
  process.exit(0);
}

const users = new Map<string, { count: number; first: string; last: string }>();
const days = new Map<string, { logins: number; users: Set<string> }>();
for (const e of entries) {
  const u = users.get(e.user) ?? { count: 0, first: e.at, last: e.at };
  u.count++;
  u.last = e.at;
  users.set(e.user, u);
  const day = e.at.slice(0, 10);
  const d = days.get(day) ?? { logins: 0, users: new Set<string>() };
  d.logins++;
  d.users.add(e.user);
  days.set(day, d);
}

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";
console.log(`Counting since:   ${fmt(entries[0].at)}`);
console.log(`Total logins:     ${entries.length}`);
console.log(`Different users:  ${users.size}`);
console.log("\nBy day          logins  users");
for (const [day, d] of days) console.log(`${day}      ${String(d.logins).padStart(6)}  ${String(d.users.size).padStart(5)}`);
const width = Math.max(5, ...[...users.keys()].map((k) => k.length));
console.log(`\n${"User".padEnd(width)}  logins  first login            last login`);
for (const [code, u] of [...users].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${code.padEnd(width)}  ${String(u.count).padStart(6)}  ${fmt(u.first)}  ${fmt(u.last)}`);
}
