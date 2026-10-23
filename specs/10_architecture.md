# 10 · Architecture

## Goal
One place where every learner proves what they learned (baseline, predict, checkpoint, recall, capstone), with results private to the person, the Planning Director and HR L&D, at zero platform cost, reachable from a phone.

## Components
| Component | Where | Tech | Owner |
|---|---|---|---|
| Hub front end | `docs/` in this repo, served by GitHub Pages (`https://<user>.github.io/the-1pct-planner/`) | Static HTML, CSS, vanilla JS, i18n JSON | Built by Claude Code, owned by Quân |
| Backend | Google Apps Script project bound to the private Sheet, deployed as a web app | Apps Script (V8) | Quân's Google account |
| Data | Private Google Sheet "1pct-planner-data" | Tabs in `11_sheet_schema.md` | Quân; shared with HR L&D as Editor; nobody else |
| Videos | Company Blink platform | MP4, one playlist per course | HR L&D uploads |

## Request flow
```
Browser (docs/)                         Apps Script web app                      Google Sheet
  │ POST {action:"login", code, pin} ──► verify PIN hash (Roster) ─────────────► read Roster
  │ ◄── {token, profile}                 create session (CacheService, 6 h)
  │ POST {action:"start", token, ...} ─► pick form + items, shuffle options ───► read Items, Attempts
  │ ◄── {attempt_id, items WITHOUT answer/why}   write Attempts row (status=open)
  │ POST {action:"save", ...} (autosave every 20 s and on each answer)
  │ POST {action:"submit", ...} ───────► grade on server, apply gate rules ────► write Attempts
  │ ◄── {score, passed, by_objective, feedback (checkpoint/predict only)}
```
- All calls are `fetch(GAS_URL, {method: "POST", body: JSON.stringify(payload)})` with header `Content-Type: text/plain;charset=utf-8` (a "simple request": no CORS preflight; Apps Script follows with a redirect that `fetch` follows automatically). Responses are JSON via `ContentService`.
- Deployment settings: Execute as **Me** (Quân); Who has access **Anyone**. Security comes from code + PIN + session token, not from Google sign-in, so learners need no Google account.
- `docs/config.js` holds `GAS_URL` only. The URL is not a secret; it is useless without a valid PIN.

## Identity
- Employee code (from HR) + 6-digit PIN (issued by HR, changeable by the learner on first login).
- PIN stored as SHA-256 of `salt + pin` (Apps Script `Utilities.computeDigest`), salt per person.
- 5 wrong PINs → 15-minute lock on that code.
- Session token: `Utilities.getUuid()`, stored in `CacheService.getScriptCache()` for 6 hours (`token → code`).
- Roles in Roster: `learner`, `manager` (also a learner), `panel` (Pitch Day / capstone judges, e.g. VPSC), `admin` (Quân, HR L&D).

## Privacy model
- The Sheet is the only store of names, scores and answers. The repo and the page hold none.
- The page shows a person only their own results. Team views come from the `team_summary` action, which returns averages only for groups of n ≥ 3 and excludes managers (`is_manager = TRUE`).
- Managers see "passed / not yet" for their own team members, never scores (`team_status` action).
- Admins work in the Sheet itself (dashboards and a custom menu, `16_admin_and_reports.md`); there is no admin web page.

## Fallback if Google is blocked on Marico laptops
Test in week 45 with three people on the company network and on phones (4G). If blocked on laptops but fine on phones, launch phone-first. If blocked everywhere, export the same item banks into Microsoft Forms quizzes (one form per assessment, company sign-in) and keep the Hub as the front door with links; grading then happens in Forms and results are pulled into the Sheet monthly.
