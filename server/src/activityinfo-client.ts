import { config } from "./config.js";

export class ActivityInfoError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`ActivityInfo API ${status}: ${body.slice(0, 200)}`);
    this.name = "ActivityInfoError";
  }
}

function authHeader(token: string): string {
  return "Basic " + Buffer.from(`email:${token}`).toString("base64");
}

async function request(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const url = `${config.aiBaseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: authHeader(token),
    Accept: "application/json",
  };
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Network hiccups (DNS not ready just after a restart, dropped connections):
    // retry reads once. Writes are not retried.
    if (init.method !== "GET") throw err;
    await new Promise((r) => setTimeout(r, 750));
    res = await fetch(url, init);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ActivityInfoError(res.status, text);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export const ai = {
  getDatabases(token: string) {
    return request("/resources/databases", token);
  },

  getDatabaseTree(token: string, databaseId: string) {
    return request(`/resources/databases/${encodeURIComponent(databaseId)}`, token);
  },

  getFormSchema(token: string, formId: string) {
    return request(`/resources/form/${encodeURIComponent(formId)}/schema`, token);
  },

  getFormTree(token: string, formId: string) {
    return request(`/resources/form/${encodeURIComponent(formId)}/tree`, token);
  },

  getFormRecords(token: string, formId: string) {
    return request(`/resources/form/${encodeURIComponent(formId)}/query`, token);
  },

  getRecord(token: string, formId: string, recordId: string) {
    return request(
      `/resources/form/${encodeURIComponent(formId)}/record/${encodeURIComponent(recordId)}`,
      token,
    );
  },

  queryColumns(token: string, formId: string, columns: Record<string, string>) {
    const qs = new URLSearchParams(columns).toString();
    return request(`/resources/form/${encodeURIComponent(formId)}/query?${qs}`, token);
  },

  updateRecords(token: string, changes: RecordChange[]) {
    return request("/resources/update", token, {
      method: "POST",
      body: { changes },
    });
  },
};

export interface RecordChange {
  formId: string;
  recordId: string;
  parentRecordId?: string | null;
  deleted: boolean;
  fields: Record<string, unknown> | null;
}
