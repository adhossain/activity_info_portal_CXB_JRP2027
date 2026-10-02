import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Usage counting: each successful login appends the time and the email (never the token). */
export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const LOGIN_LOG = path.join(DATA_DIR, "logins.jsonl");

export async function recordLogin(email: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const entry = { at: new Date().toISOString(), email: email.trim().toLowerCase() };
  await appendFile(LOGIN_LOG, JSON.stringify(entry) + "\n");
}
