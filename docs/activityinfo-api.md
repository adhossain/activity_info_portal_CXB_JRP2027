# ActivityInfo API v2 — Reference Notes

Verified against official docs at
https://www.activityinfo.org/support/docs/api/reference/ (October 2026).

## Authentication

Every request uses HTTP Basic Auth: username is ignored (any string),
password is the user's **Personal API Token** (generated from Profile
Settings in ActivityInfo). Email+password login is deprecated.

```
Authorization: Basic base64("anything:<API_TOKEN>")
```

A 401 `AUTHENTICATION_REQUIRED` is returned when credentials are missing or
invalid.

## Endpoints Used in This Portal

### List databases

```
GET /resources/databases
```

Returns `Array<Database>`:

```jsonc
{
  "databaseId": "ck8oykh8m5",
  "label": "2018 IRQ IDP",
  "description": "",
  "ownerId": "432201",
  "billingAccountId": 1025232,
  "suspended": false,
  "publishedTemplate": false,
  "languages": ["en", "ar"]
}
```

### Database tree (folders + forms)

```
GET /resources/databases/{databaseId}
```

Returns a tree with `resources[]`, each having:

| field      | type   | notes                                    |
|------------|--------|------------------------------------------|
| id         | string | globally unique form/folder id           |
| type       | enum   | FOLDER, FORM, SUB_FORM, REPORT, DATABASE |
| parentId   | string | parent container id                      |
| label      | string | human-readable name                      |
| visibility | string | visibility setting                       |

### Form schema

```
GET /resources/form/{formId}/schema
```

Returns:

```jsonc
{
  "id": "cuid",
  "label": "Form Name",
  "schemaVersion": "3",
  "databaseId": "ck8oykh8m5",
  "parentFormId": "optional — set if subform",
  "elements": [ /* fields */ ]
}
```

Each element:

| field                | type    | notes                                     |
|----------------------|---------|-------------------------------------------|
| id                   | string  | field cuid                                |
| code                 | string? | dev-friendly code                         |
| label                | string  | display name                              |
| description          | string? | help text                                 |
| type                 | enum    | see Field Types below                     |
| required             | bool    |                                           |
| key                  | bool    | part of unique key                        |
| relevanceCondition   | string? | formula                                   |
| validationCondition  | string? | formula                                   |
| typeParameters       | object  | type-specific config (see below)          |

#### Field types

| type                  | typeParameters keys                                |
|-----------------------|----------------------------------------------------|
| FREE_TEXT             | inputMask?, barcode?                               |
| NARRATIVE             | —                                                  |
| quantity              | units                                              |
| date                  | —                                                  |
| month                 | —                                                  |
| fortnight             | —                                                  |
| epiweek               | —                                                  |
| enumerated            | cardinality (SINGLE/MULTIPLE), presentation, values[{id,label}] |
| reference             | range[{formId}], lookupConfigs?                    |
| multiselectreference  | range[{formId}]                                    |
| subform               | formId                                             |
| reversereference      | formId, fieldId                                    |
| geopoint              | —                                                  |
| attachment            | captureMethods[], fileTypes[]                      |
| Serial                | prefixFormula?                                     |
| calculated            | formula                                            |
| note                  | —                                                  |
| section               | — (grouping header, not a data field)              |

### Get records (column query)

```
GET /resources/form/{formId}/query
```

Returns `Array<Record>` where keys are field codes/labels. Simple flat
format useful for table views.

### Query rows (advanced)

```
POST /resources/query/rows
```

Body:

```jsonc
{
  "formId": "string",
  "columns": [{ "id": "col1", "formula": "field_code" }],
  "sort": [{ "formula": "field_code", "dir": "ASC" }],
  "filter": "boolean formula (optional)",
  "truncateStrings": false
}
```

Returns `Array<object>` keyed by column id.

### Get single record

```
GET /resources/form/{formId}/record/{recordId}
```

Returns:

```jsonc
{
  "recordId": "string",
  "formId": "string",
  "parentRecordId": "string?",
  "lastEditTime": 1609459200.0,
  "fields": {
    "<fieldId>": "<value>"
  }
}
```

#### Field value shapes

| type          | value shape                                    |
|---------------|------------------------------------------------|
| FREE_TEXT     | `"string"`                                     |
| NARRATIVE     | `"string"`                                     |
| quantity      | `42.5` (number)                                |
| date          | `"2019-12-31"`                                 |
| enumerated    | `["enumValueId1", ...]`                        |
| reference     | `"formId:recordId"`                            |
| geopoint      | `{ "latitude": 52.07, "longitude": -4.3 }`    |
| attachment    | `[{ "mimeType", "filename", "blobId" }]`       |
| Serial        | `{ "prefix": "AA", "number": 3423 }`          |
| calculated    | computed value (string or number)              |

Verified on real data (Oct 2026): single reference = `"formId:recordId"`,
multi-select reference = array of those, single enum = value id string,
multiple enum = array of ids, month = `"2027-01"`.

### Form tree (form + subforms + referenced forms in one call)

```
GET /resources/form/{formId}/tree
```

Returns `{ root, forms: { [formId]: { id, schema, schemaVersion, permissions } } }`.
Much faster than fetching each schema in turn.

### Column queries

`GET /resources/form/{formId}/query?col=formula&...` returns only the named
columns, e.g. `?id=_id&parent=@parent&sector=<refFieldId>` (a reference
column gives the record id).

### Subform records

`GET /resources/form/{subformId}/records/{parentRecordId}` returns **404** —
do not use. Instead query `?id=_id&parent=@parent` on the subform, keep rows
whose `parent` matches, then fetch each with `GET .../record/{id}`.

### Flat query column names

The plain `GET .../query` keys columns by field **code**, or label when there
is no code. Referenced records are expanded as `<code>.@id`, `<code>.<col>`
(several levels deep). Enum values come back as labels.

## Rules in the schema

| property             | meaning                                                         |
|----------------------|-----------------------------------------------------------------|
| relevanceCondition   | show-if; on a section it hides everything below it until the next section with the same or lower `indentationLevel` |
| requiredCondition    | required-if                                                     |
| validationCondition  | must hold for a non-empty value; `validationMessage` is shown   |
| validationCondition on a reference field | also **filters the choice list** (e.g. `sector.module_projects_submissions == 1`) |
| lookupConfigs        | pick a referenced record step by step (Objective → Activity Group → Sub-Activity) |
| defaultValue         | initial value for new records                                    |
| dataEntryVisible: false | hidden in data entry, value kept                              |
| unique (often on a calculated field) | no two records may share the value         |

Formula paths: `field`, `refField.targetField`, `enumField.valueId` (true if
chosen), `@parent.field`, `subform.field` (list, for SUM/COUNT/MAX), `_id`.

## Permissions

`GET /resources/databases/{id}` → `grants[]`, each
`{ resourceId, operations: [{ operation, filter }] }`. A record-level filter
looks like `"cd0f63nmttzvy7o1s12" == c5qb1g6mttyn6kd5kfu` (record id == the
table that the form's single reference field points to). ActivityInfo applies
it to that single-choice field only, not to multi-select fields on the same
table.

## Network note

The VM has no working IPv6 route. The server sets `ipv4first` and a longer
connection attempt time; without that, calls to ActivityInfo fail now and then
with `fetch failed … ETIMEDOUT`.
