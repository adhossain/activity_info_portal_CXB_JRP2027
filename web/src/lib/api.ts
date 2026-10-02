function upstreamMessage(detail: unknown): string | undefined {
  if (typeof detail !== "string" || !detail) return undefined;
  try {
    const parsed = JSON.parse(detail);
    const msg = parsed.message ?? parsed.error ?? parsed.code;
    return typeof msg === "string" ? `ActivityInfo: ${msg}` : undefined;
  } catch {
    return `ActivityInfo: ${detail.slice(0, 300)}`;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    if (!url.includes("/auth/")) {
      window.location.href = "/login";
    }
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(upstreamMessage(body.detail) ?? body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  login(email: string, token: string) {
    return request<{ ok: boolean; email: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, token }),
    });
  },

  logout() {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  },

  me() {
    return request<{ email: string }>("/api/auth/me");
  },

  getDatabases() {
    return request<Database[]>("/api/databases");
  },

  getDatabaseTree(databaseId: string) {
    return request<DatabaseTree>(`/api/databases/${encodeURIComponent(databaseId)}`);
  },

  getGrants(databaseId: string) {
    return request<GrantsResponse>(`/api/databases/${encodeURIComponent(databaseId)}/grants`);
  },

  getFormSchema(formId: string) {
    return request<FormSchema>(`/api/forms/${encodeURIComponent(formId)}/schema`);
  },

  getFormTree(formId: string) {
    return request<FormSchema[]>(`/api/forms/${encodeURIComponent(formId)}/tree`);
  },

  getFormRecords(formId: string) {
    return request<FormRecordsResponse>(
      `/api/forms/${encodeURIComponent(formId)}/records`,
    );
  },

  getRecord(formId: string, recordId: string) {
    return request<RecordData>(
      `/api/forms/${encodeURIComponent(formId)}/records/${encodeURIComponent(recordId)}`,
    );
  },

  getSubformRecords(subformId: string, parentRecordId: string) {
    return request<RecordData[]>(
      `/api/forms/${encodeURIComponent(subformId)}/subrecords/${encodeURIComponent(parentRecordId)}`,
    );
  },

  saveChanges(changes: RecordChange[]) {
    return request<{ ok: boolean }>("/api/changes", {
      method: "POST",
      body: JSON.stringify({ changes }),
    });
  },

  deleteRecord(formId: string, recordId: string) {
    return request<{ ok: boolean }>(
      `/api/forms/${encodeURIComponent(formId)}/records/${encodeURIComponent(recordId)}`,
      { method: "DELETE" },
    );
  },
};

export interface Database {
  databaseId: string;
  label: string;
  description: string;
  suspended: boolean;
}

export interface DatabaseTree {
  databaseId: string;
  label: string;
  description: string;
  resources: Resource[];
  grants?: Grant[];
}

export interface Grant {
  resourceId: string;
  operations: GrantOperation[];
  conditions?: unknown[];
}

export interface GrantOperation {
  operation: string;
  filter: string | null;
}

export interface Resource {
  id: string;
  type: "FOLDER" | "FORM" | "SUB_FORM" | "REPORT" | "DATABASE";
  parentId: string;
  label: string;
  visibility: string;
}

export interface FormSchema {
  id: string;
  label: string;
  schemaVersion: string;
  databaseId: string;
  parentFormId?: string;
  elements: FormElement[];
}

export interface FormElement {
  id: string;
  code?: string;
  label: string;
  description?: string;
  type: string;
  required?: boolean;
  key?: boolean;
  unique?: boolean;
  relevanceCondition?: string;
  requiredCondition?: string;
  validationCondition?: string;
  validationMessage?: string;
  defaultValue?: unknown;
  dataEntryVisible?: boolean;
  tableVisible?: boolean;
  typeParameters?: TypeParameters;
}

export interface TypeParameters {
  /** ActivityInfo sends "single" / "multiple" (compare case-insensitively). */
  cardinality?: string;
  indentationLevel?: number;
  presentation?: string;
  values?: { id: string; label: string }[];
  range?: { formId: string }[];
  formId?: string;
  fieldId?: string;
  formula?: string;
  units?: string;
  inputMask?: string;
  barcode?: boolean;
  captureMethods?: string[];
  fileTypes?: string[];
  prefixFormula?: string;
  lookupConfigs?: { formula: string; lookupLabel: string }[];
}

export interface GrantsResponse {
  grants: Grant[];
}

export interface RecordChange {
  formId: string;
  recordId: string;
  parentRecordId: string | null;
  deleted: boolean;
  fields: Record<string, unknown> | null;
}

export interface FormRecordsResponse {
  keys: string[];
  rows: Record<string, unknown>[];
}

export interface RecordData {
  recordId: string;
  formId: string;
  parentRecordId?: string;
  lastEditTime: number;
  fields: Record<string, unknown>;
}
