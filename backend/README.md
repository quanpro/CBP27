# backend/ · Google Apps Script

The Hub's private backend: grading, retake rules and privacy, running in the Planning Director's Google account next to the private Sheet "1pct-planner-data". Built from `specs/10`–`20` (`specs/19` and `specs/20` win). Deploy with **[DEPLOY.md](DEPLOY.md)**.

| File | What it holds |
|---|---|
| `Seed.gs` | **Generated** by `tools/gen_seed.mjs` from `docs/data/courses.json`: course order and default dates, episode numbers and titles, the 0–4 self-rating scale. Public data only. |
| `Logic.gs` | Pure functions (no Google services; also loads in Node): PIN hashing, signed tokens, lockout escalation, seeded shuffle, `serveItem`, grading, form choice, retake/unlock/late gate, reveal rule, recall dates and items, summaries with small-group suppression, streak, +07:00 date helpers, CSV parsing, item-bank validation; Baseline v2: `serveBaselineItem`, answer cleaning, SJT lock rule, Part 1 form choice, Part 3 module routing, scoring, rating validation, mean-sigma equating, level, charter index and flags, course links, IDP gaps, `buildBaselineProfile`, item statistics, `validateBaselineBank`. |
| `Data.gs` | Sheet schema (every tab and column), table reads/writes as plain text, Config, CacheService (10 min, split per assessment/course/form), the script lock, the Log. |
| `Code.gs` | `doPost` router and `doGet` health check. Every response is JSON with `server_now`. |
| `Auth.gs` | `login`, `change_pin`, `consent`, `set_lang`; session tokens (`v1.payload.HMAC`), peppered PIN hashes, locks, `must_change_pin` enforcement. |
| `Assess.gs` | `me`, `watch`, `start`, `save`, `submit`, `review`, `team_summary`, `team_status`, `capstone_get`, `capstone_submit`, `panel_list`, `panel_score` (shapes in `specs/20_api_contract.md`). |
| `Baseline.gs` | Baseline v2 (`specs/22`): the three parts (`start`/`save`/`submit` branches, `baseline_next`), timers and expiry, `me.baseline`, `rate_list` / `rate_get` / `rate_save`, `profile`, `buildProfiles()`, equating, baseline team numbers. |
| `Admin.gs` | The **1% Planner** menu in the Sheet: import/validate, PINs, unlocks, voids, summaries, dashboards, hourly trigger; Baseline v2 switches dialog, Assign a Part 1 form…, Build baseline profiles, Baseline v2 reports. |
| `Setup.gs` | `setupSheet()`: creates or repairs every tab (idempotent), plain-text cells, time zone, Config defaults, secrets. |
| `appsscript.json` | Manifest: Asia/Ho_Chi_Minh, V8, web app "Execute as me / Anyone", minimal scopes. |
| `dist/` | **Generated** by `tools/bundle_backend.mjs`: `Hub.gs` (all files in one, to paste into the editor) and `appsscript.json`. |
| `tests/logic.test.js` | Unit tests for `Logic.gs` (re-runs under several time zones). |
| `tests/api.test.js` | End-to-end tests through `doPost` on the harness, with invented fixtures. |
| `tests/harness.js` | Node `vm` harness with in-memory fakes of SpreadsheetApp (including Sheets' type coercion), CacheService, LockService, PropertiesService, Utilities, ContentService, HtmlService, ScriptApp and a settable clock. |
| `tests/fixtures.js` | Invented items (`FX_A2_A_01` …), an invented full-size baseline bank (`MOCK-BL-…`, exhibits `MOCK-EX-…`, BaselineText), courses, a case and roster (`T001` …). No real content. |
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
Dev server accounts (all PIN `246810`): `T001`, `T005` demand · `T002`, `T006` supply · `T003` materials · `T004` cs · `T007` materials, all three baseline parts already done and rated by T010 · `T010` manager of T001–T003 and T007 (rates them) · `T050` admin (rates T010) · `T020` panel judge · `T030` must change PIN. All courses are open; baseline Parts 1–3 and manager rating are open, results are closed. Open the Hub at `http://localhost:8787/?api=http://localhost:8787/api`. Dev-only hooks: `POST /__dev/clock {"add_hours": 24}` moves the server clock forward; `POST /__dev/config {"key": "results_open", "value": "TRUE"}` flips a baseline switch (`p1_open p2_open p3_open rating_open results_open p1_minutes p2_minutes p3_minutes grace_minutes`); `POST /__dev/build {"what": "profiles"|"summary"}` runs `buildProfiles()` / `buildSummary()`.

## Rules the code keeps
- Served items are built from a whitelist: never `answer`, `why_*` or `correct` before submission (tests deep-scan every `start`). Baseline items never carry `answer`, `answer_most`, `answer_least`, `why_*`, `step`, `move`, `gate`, `level` or `charter`, before or after a sitting, and Part 2 rating statements are not sent before the SJT is locked.
- The checkpoint key and "why" are shown only after the learner passes that course (decision D5, hardened: no time-based reveal).
- Team views: groups and per-metric counts under `team_view_min_n` are left out, managers and `test` users are never counted, a group or metric is also hidden when "all minus the shown groups" would single out fewer than `min_n` people, and numbers are published (by `buildSummary`, never on a request): baseline numbers only while Config `results_open` is TRUE, each course's checkpoint numbers only after its late window has closed.
- Wrong PINs are counted in CacheService for every code, known or not: no Sheet write, no script lock and no Log row for anonymous failures. 15 min, 30 min, then a lock that needs an admin (3 locks in 7 days).
- Consent is enforced on the server (`consent_required`); `logout` signs out every device.
- The Log tab never receives PINs, answers or tokens.
