# 17 · Build plan for Claude Code (with acceptance tests)

Work top to bottom. Each step ends with its acceptance test passing; commit after each step with a clear message. Target: Hub live for the baseline pilot by Fri 13 Nov 2026; baseline opens Mon 16 Nov.

## Step 0 · Repository hygiene (30 min)
- Confirm `.gitignore` contains `content-private/` and `*.csv`.
- Add a pre-commit check script `tools/check_no_private.sh` that fails if any staged file lives under `content-private/`, is a `.csv`/`.xlsx`, matches a literal answer key (`"answer"\s*:\s*"[a-d]"`), or contains an item id from the bank (`\b(A[123]|C1|P[1-6]|BL)-(A|B|PR|[A-Z0-9]{2,4})-[0-9]{2}\b`). The mock API uses invented ids (`MOCK-01`…) and a differently named field (`mockCorrect`).
- **Accept:** `git status` shows no files from `content-private/`; the script fails on a planted test file and passes after it is removed.

## Step 1 · Pure logic + tests (backend/Logic.gs) (2–3 h)
- Implement `hashPin, pickForm, canRetake, shuffle, serveItem, grade, byCourse, recallDates, summarise` exactly as `12_backend_api.md` and `14_assessment_rules.md` describe. Make `Logic.gs` loadable in Node (`module.exports` guarded by `typeof module !== "undefined"`).
- **Accept:** `node backend/tests/logic.test.js` passes ≥ 25 assertions, including: serveItem never returns `answer`/`why`; 8/10 passes and 7/10 fails; retake at 23 h 59 m rejected, at 24 h allowed; attempt 3 without unlock rejected; summarise drops groups with n < 3 and every manager row; recall dates for a forum on 2027-03-23 are 03-25, 03-30, 04-22.

## Step 2 · Sheet + Apps Script (3–4 h)
- `Setup.gs` creates the tabs in `11_sheet_schema.md`; `Admin.gs` adds the menu in `16_admin_and_reports.md`; `Auth.gs`, `Assess.gs`, `Code.gs` implement `12_backend_api.md`.
- Quân deploys (manual, documented in `backend/DEPLOY.md` you write): create the Sheet, open Extensions ▸ Apps Script, paste files (or use `clasp`), run `setupSheet`, import `Items.csv` and `Courses.csv`, add 3 test roster rows, issue PINs, deploy web app (Execute as Me, Anyone), copy the URL into `docs/config.js`.
- **Accept (manual, with Quân):** curl-style test from a browser console: login with a test code → start checkpoint A2 → response has 10 items and no `answer` field → submit with all "a" → score returned and an Attempts row exists; Log tab has no PIN or answers.

## Step 3 · Front end skeleton (3 h)
- `docs/index.html`, `css/hub.css` (tokens from `13_hub_pages.md`), `js/i18n.js` + `i18n/en.json` + `i18n/vi.json`, `js/api.js` with `?mock=1` using `js/mock-api.js` (fake items only, e.g. "Mock question 1"), logo.
- **Accept:** Playwright: login (mock) → journey shows 10 courses in calendar order A2, A3, A1, P1, C1, P2, P3, P4, P5, P6; EN/VI toggle changes every visible string; no horizontal scroll at 360 px; dark mode readable.

## Step 4 · Quiz runner + course page (4 h)
- `course.html`, `quiz.html`, `js/quiz.js`: predict, checkpoint, recall; autosave every 20 s and on each answer; result screens per `14_assessment_rules.md`.
- **Accept:** Playwright (mock): checkpoint pass path and not-yet path render the right next steps; reload mid-quiz resumes answers; VI toggle mid-quiz keeps answers.

## Step 5 · Baseline (4 h)
- `baseline.html`: three parts, sticky case panel, 60-minute timer with auto-submit, resume.
- **Accept:** Playwright (mock): cannot submit with fewer than 10 self-ratings; timer auto-submits at 0; result shows per-course bars and "two largest gaps".

## Step 6 · Team, capstone, panel, about (3 h)
- `team.html` (heatmap from `team_summary`, manager view from `team_status`), `capstone.html`, `panel.html`, `about.html`.
- **Accept:** Playwright (mock): team view hides a group with n = 2; manager sees "passed / not yet" only; panel can save five scores and a comment.

## Step 7 · Real-backend pilot (with Quân, week of 9 Nov)
- Three pilot users (two AI-ready planners and one manager) take the baseline on a Marico laptop and on a phone.
- **Accept:** all three complete; Attempts rows correct; timings recorded; any item flagged as unclear is fixed in the Sheet (not in the repo); Google reachable from the company network (if not, switch to the fallback in `10_architecture.md`).

## Step 8 · Launch checklist
- `specs/18_security_privacy_checklist.md` all ticked; GitHub Pages enabled on `main` / `docs`; README updated with the Hub URL; HR has PIN cards; Blink playlists for A2 and A3 named per `program/05_blink_upload_guide.md`.
