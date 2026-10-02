import crypto from "node:crypto";

export interface SessionData {
  email: string;
  token: string; // ActivityInfo API token
  createdAt: number;
}

export interface SessionStore {
  get(id: string): SessionData | undefined;
  set(id: string, data: SessionData): void;
  delete(id: string): void;
}

class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionData>();

  get(id: string) {
    return this.sessions.get(id);
  }

  set(id: string, data: SessionData) {
    this.sessions.set(id, data);
  }

  delete(id: string) {
    this.sessions.delete(id);
  }
}

export const sessionStore: SessionStore = new MemorySessionStore();

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let encKey: Buffer | null = null;

function getKey(secret: string): Buffer {
  if (!encKey) {
    encKey = crypto.scryptSync(secret, "activityinfo-portal-salt", 32);
  }
  return encKey;
}

export function encryptToken(token: string, secret: string): string {
  const key = getKey(secret);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptToken(blob: string, secret: string): string {
  const key = getKey(secret);
  const buf = Buffer.from(blob, "base64url");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final("utf8");
}
