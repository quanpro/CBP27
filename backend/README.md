# backend/ · Google Apps Script

The Hub's private backend: grading, retake rules and privacy, running in the Planning Director's Google account next to the private Sheet "1pct-planner-data". Built from `specs/10`–`20` (`specs/19` and `specs/20` win). Deploy with **[DEPLOY.md](DEPLOY.md)**.

| File | What it holds |
|---|---|
| `Seed.gs` | **Generated** by `tools/gen_seed.mjs` from `docs/data/courses.json`: course order and default dates, episode numbers and titles, the 0–4 self-rating scale. Public data only. |
| `Logic.gs` | Pure functions (no Google services; also loads in Node): PIN hashing, signed tokens, lockout escalation, seeded shuffle, `serveItem`, grading, form choice, retake/unlock/late gate, reveal rule, recall dates and items, summaries with small-group suppression, streak, +07:00 date helpers, CSV parsing, item-bank validation. |
| `Data.gs` | Sheet schema (every tab and column), table reads/writes as plain text, Config, CacheService (10 min, split per assessment/course/form), the script lock, the Log. |
| `Code.gs` | `doPost` router and `doGet` health check. Every response is JSON with `server_now`. |
| `Auth.gs` | `login`, `change_pin`, `consent`, `set_lang`; session tokens (`v1.payload.HMAC`), peppered PIN hashes, locks, `must_change_pin` enforcement. |
| `Assess.gs` | `me`, `watch`, `start`, `save`, `submit`, `review`, `team_summary`, `team_status`, `capstone_get`, `capstone_submit`, `panel_list`, `panel_score` (shapes in `specs/20_api_contract.md`). |
| `Admin.gs` | The **1% Planner** menu in the Sheet: import/validate, PINs, unlocks, voids, summaries, dashboards, hourly trigger. |
| `Setup.gs` | `setupSheet()`: creates or repairs every tab (idempotent), plain-text cells, time zone, Config defaults, secrets. |
| `appsscript.json` | Manifest: Asia/Ho_Chi_Minh, V8, web app "Execute as me / Anyone", minimal scopes. |
| `dist/` | **Generated** by `tools/bundle_backend.mjs`: `Hub.gs` (all files in one, to paste into the editor) and `appsscript.json`. |
| `tests/logic.test.js` | Unit tests for `Logic.gs` (re-runs under several time zones). |
| `tests/api.test.js` | End-to-end tests through `doPost` on the harness, with invented fixtures. |
| `tests/harness.js` | Node `vm` harness with in-memory fakes of SpreadsheetApp (including Sheets' type coercion), CacheService, LockService, PropertiesService, Utilities, ContentService, HtmlService, ScriptApp and a settable clock. |
| `tests/fixtures.js` | Invented items (`FX_A2_A_01` …), courses, a case and roster (`T001` …). No real content. |
| `dev/server.mjs` | Local QA server: serves `docs/` and answers `POST /api` with the real backend code on the harness. |

## Commands
```sh
node backend/tests/logic.test.js        # pure logic
node backend/tests/api.test.js          # end to end (also checks Seed.gs and dist/ are current)
npm run test:backend                    # both
node tools/gen_seed.mjs                 # after editing docs/data/courses.json
node tools/bundle_backend.mjs           # after editing any backend/*.gs (rebuilds dist/)
node backend/dev/server.mjs --port 8787 [--clock-offset-hours N]
```
Dev server accounts (all PIN `246810`): `T001`, `T005` demand · `T002`, `T006` supply · `T003` materials · `T004` cs · `T010` manager of T001–T003 · `T020` panel judge · `T030` must change PIN. All courses are open and the baseline window is open; open the Hub at `http://localhost:8787/?api=http://localhost:8787/api`. `POST /__dev/clock {"add_hours": 24}` moves the server clock forward (to test the 24-hour retake).

## Rules the code keeps
- Served items are built from a whitelist: never `answer`, `why_*` or `correct` before submission (tests deep-scan every `start`).
- The checkpoint key and "why" are shown only after the learner passes that course (decision D5, hardened: no time-based reveal).
- Team views: groups and per-metric counts under `team_view_min_n` are left out, managers and `test` users are never counted, a group or metric is also hidden when "all minus the shown groups" would single out fewer than `min_n` people, and numbers are published (by `buildSummary`, never on a request) only after the baseline window / each course's late window has closed.
- Wrong PINs are counted in CacheService for every code, known or not: no Sheet write, no script lock and no Log row for anonymous failures. 15 min, 30 min, then a lock that needs an admin (3 locks in 7 days).
- Consent is enforced on the server (`consent_required`); `logout` signs out every device.
- The Log tab never receives PINs, answers or tokens.
