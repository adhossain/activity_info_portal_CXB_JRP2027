# ActivityInfo Portal – JRP 2027-28 Project Submissions (Cox's Bazar)

A web portal for entering and reviewing projects in the **JRP 2027-28 Appeal – Project Submission Template** of the *Bangladesh Rohingya Refugees Joint Response Plan* database on [ActivityInfo](https://www.activityinfo.org).

You sign in with your own ActivityInfo account and API token. Everything you read or save goes straight to ActivityInfo, which remains the system of record. The portal adds a simpler data-entry experience on top: it applies the form's rules as you type, organises activities by objective, and exports a submission to PDF.

## Disclaimer

> This platform is developed by an independent self-taught tech enthusiast and is not affiliated with ActivityInfo or any other organisation. Data accuracy is not guaranteed; please verify all entries in ActivityInfo before submission. The developer is not liable for any errors. No data is stored in this platform's own database. Your API token and data are exchanged directly with ActivityInfo.
>
> The platform is hosted on the developer’s personal home server, making uptime dependent on the internet connection, electricity supply, and occasional interference from his four-year-old son.
>
> --- Adnan<br>
> Contact: [admin@adhossain.xyz](mailto:admin@adhossain.xyz)

## What it does

- **Sign in with ActivityInfo.** You need your email and a personal API token with **Read & Write** scope. The login page has a step-by-step guide to creating one.
- **Browse** your databases and forms. The JRP database and the Project Submission form are highlighted.
- **Create, edit and delete projects**, including all their sub-forms: 02 Activities, 2.A Locations, 03 Targets and 04 Cross-Cutting Themes. A project and all its rows are saved to ActivityInfo in one request.
- **Applies the form's own ActivityInfo rules in the browser:**
  - fields that show or hide based on other answers;
  - required fields, and validation rules with their messages;
  - reference lists filtered the way ActivityInfo filters them;
  - step-by-step picking (Objective → Activity Group → Sub-Activity);
  - calculated fields, default values and duplicate-row checks;
  - the record-level permission on the Project Focal Point Organization.
- **Adds checks for this form** that ActivityInfo does not enforce:
  - character limits on narrative answers;
  - email format for the representatives;
  - whole-number budgets and targets;
  - project dates between January 2027 and December 2028, with the end date not before the start date;
  - at least two PSEA activities;
  - targets no larger than the population of the area (from `PS_ref_blocks_population`);
  - no Host Community targets in Bhasan Char;
  - camps and blocks that match the activity's population;
  - at least one location per activity at final submission.
- **Activities grouped by objective:** each objective is a row, with its activity groups and their activities nested inside.
- **Export to PDF:** a project prints with every section expanded.

### Limitations

- **Files** (e.g. the GAM Report) must be uploaded in ActivityInfo; the portal shows a reminder.
- **There is no "save as draft" yet:** saving requires all required answers. Use the form's own "Final submission / Draft" question to mark drafts.
- **Two people editing the same project at once:** the last save wins.

## How it works

```
Browser (React + Vite)  ──>  nginx  ──>  Fastify server  ──>  ActivityInfo API v2
                              /api/*       (your token)
```

- **Your API token is kept only in server memory, encrypted** (AES-256-GCM). The browser receives only an httpOnly session cookie, and every call to ActivityInfo uses your own token, so ActivityInfo applies your permissions.
- **Form rules are evaluated in the browser** by a small interpreter for ActivityInfo's formula language (`web/src/lib/formula.ts`, `formLogic.ts`). The extra checks for this form live in `web/src/lib/portalRules.ts`.
- **Usage counting:** for each successful login, the server appends the time and email address to `/data/logins.jsonl` in a Docker volume. API tokens are never written anywhere.

## Running it

Requirements: Docker with Compose.

```sh
git clone https://github.com/adhossain/activity_info_portal_CXB_JRP2027.git
cd activity_info_portal_CXB_JRP2027
cp .env.example .env
# set SESSION_SECRET in .env to a long random value, e.g. the output of: openssl rand -hex 32
docker compose up --build -d
```

Then open <http://localhost:8088>.

| Setting (`.env`) | Meaning | Default |
|---|---|---|
| `SESSION_SECRET` | Key used to encrypt API tokens in server memory (**required**) | – |
| `ACTIVITYINFO_BASE_URL` | ActivityInfo address | `https://www.activityinfo.org` |
| `WEB_PORT` | Port the portal is published on | `8088` |

**How many people have used it:**

```sh
docker compose exec server node dist/login-stats.js
```

### Development

```sh
cd server && npm install && SESSION_SECRET=dev-only-secret npx tsx watch src/index.ts   # API on port 3000
cd web && npm install && npm run dev                      # Vite dev server, proxies /api to port 3000
```

Type-check with `npx tsc --noEmit` in `server/` and `web/`.

## Project structure

```
server/   Fastify API: login, sessions, proxy to ActivityInfo, batch saves, login log
web/      React app: forms, rule engine, PDF export, login guide
docs/     Notes on the ActivityInfo API and the form's rules
```

To adapt the portal to another ActivityInfo form, change the form-specific ids in `web/src/lib/portalRules.ts` (extra checks) and `web/src/lib/featured.ts` (highlighted database and form). The rule engine itself is generic.

## License

[MIT](LICENSE). Use, change and share it freely; it comes without any warranty.
