# tests/ · end-to-end suite for The 1% Planner Hub

Playwright drives the real pages in `docs/` in Chromium, in two projects:

| Project | Pages opened with | Backend | Runs |
|---|---|---|---|
| **mock** | `?mock=1` | `docs/js/mock-api.js` in the browser (demo accounts `DEMO-L`, `DEMO-M`, `DEMO-N`, PIN `270127`; fresh demo state per test) | in parallel |
| **real** | `?api=http://localhost:8787/api` | the **real backend code** (`backend/*.gs`) on the Node harness, served by `backend/dev/server.mjs` with invented fixtures (`T001`…`T050`, PIN `246810`; baseline parts 1–3 and manager rating open, results closed; `T007` has done all three parts and is rated by `T010`) | one at a time (one in-memory backend) |

Nothing leaves the machine: no Google account, no secrets, no real items.

## Run everything (3 commands)

```sh
npm ci                                  # @playwright/test + @axe-core/playwright (exact versions)
npx playwright install chromium         # skip if Chromium is preinstalled (PLAYWRIGHT_BROWSERS_PATH)
npm test                                # privacy guard --all + backend tests + both e2e projects
```

Only the browser tests: `npm run test:e2e` (both), `npm run test:e2e:mock`, `npm run test:e2e:real`.
One file: `npx playwright test tests/e2e/quiz.spec.mjs --project=mock`.
The HTML report goes to `tests/.tmp/report` (`npx playwright show-report tests/.tmp/report`); traces and
screenshots of failures to `tests/.tmp/results`. Both are git-ignored.

Options (environment):
- `E2E_PORT=8811` runs the dev server on another port (default 8787).
- `PW_CHROMIUM=/path/to/chrome` uses a specific Chromium binary.
- `CI=1` turns on retries (1), `forbidOnly` and the GitHub reporter (`.github/workflows/ci.yml`).

**The real project needs a fresh dev server.** Playwright starts `node backend/dev/server.mjs --port 8787`
and stops it afterwards. Locally it *reuses* a server that is already running on that port; that server
may hold state from earlier clicks (a changed PIN, a submitted baseline). `global-setup.mjs` probes a few
fixture accounts and, if the state is not fresh, every real test stops with a message saying so. Stop the
other server or pick another `E2E_PORT`.

## What the always-on guards check (every test, both projects)

`helpers/hub.mjs` wraps every test:
- **Answer-key leak test.** Every API payload the page receives is recorded — real: each `POST /api`
  response (intercepted in flight); mock: each result of `mock-api.js` `handle()` (the module is wrapped
  while it loads, the file on disk is untouched). `helpers/scan.mjs` deep-scans each one:
  - `answer`, `answer_most`, `answer_least`, `mockCorrect` never appear, in any action;
  - the baseline's scoring keys `step`, `move`, `gate`, `level`, `charter` never appear, except the three
    known non-item places: `scale[i].level` (the 0–4 self-rating scale), `me.certificates.level` and the
    learner's own `profile.p3.level`;
  - `correct`, `why_en`, `why_vi` only inside review rows of a submitted course quiz (`submit` / `review`
    → `missed[i]` / `review[i]`; `by_objective.n.correct` is a count);
  - every served item carries exactly its whitelist: course quizzes `item_id, course, objective, case_id,
    stem_en, stem_vi, options`; baseline `BMcq`, `BSjt`, `BRating` (specs/22 §4, by `type`, in `start`
    sections and `baseline_next`); the manager form's statements in `rate_get`; options `id, en, vi`.
  `security.spec.mjs` proves the scanner catches each planted key and accepts only the three `level`s.
- **Hosts.** Requests may go only to the Hub itself, `fonts.googleapis.com` and `fonts.gstatic.com`.
  Google Fonts are answered locally (empty CSS) so runs are offline and deterministic; any other host is
  blocked and fails the test.
- **No uncaught page errors**, and **no missing strings** (the Hub logs `[i18n] missing …` on localhost).
- The dev server clock is put back if a test moved it (`POST /__dev/clock`), and every Config switch a
  test changed (`POST /__dev/config`: `p1_open` … `results_open`, `p1_minutes` …) goes back to the dev
  defaults. `hub.setSwitch()` does the same in the mock (demo state in `localStorage`).

## The specs

| File | Covers |
|---|---|
| `shell.spec.mjs` | Step 3: sign-in → My learning lists the 10 courses in calendar order A2 A3 A1 P1 C1 P2 P3 P4 P5 P6; EN/VI toggle changes every visible string on every page (no raw keys, VI remembered after reload); no horizontal scroll at 360 px on every page in EN and VI; dark mode (`data-theme`, dark tokens, OS dark); axe colour-contrast on key pages in light and dark. |
| `onboarding.spec.mjs` | First sign-in: own PIN (weak / mismatching refused), then the privacy notice, then the dashboard, other pages gated meanwhile; `consent_required` before the notice; sign-out ends the session on the server (`logout`); five wrong PINs → locked message, right PIN refused while locked; unknown codes get identical answers (real); client-side format checks. |
| `quiz.spec.mjs` | Step 4: checkpoint not yet (weak objectives, rewatch links, own answers only, **no correct answers**: `reveal` false) → retake blocked (screen + server `retake_too_soon`) → wait (mock: `page.clock`; real: dev clock +24 h, sign in again) → other form → pass (right answers + why, forum date, recall dates) → the first attempt's review now reveals → recall due → 3 items → review with answers; reload mid-quiz resumes answers and option order (from the local draft and from the server alone); VI mid-quiz keeps answers and place; no reveal after the late window without a pass; predict shows the answers. |
| `baseline.spec.mjs` | Baseline v2 (specs/22): part chooser; a part whose switch is off is closed ("opens when your admin starts it"; server `not_open`); v1 `start {assessment: "baseline"}` is `bad_request`. **Part 1**: free movement between sections A and B, case title and exhibits beside the question (folded above it on phones), autosave + resume (from the device and from the server alone, same option order), submit → "Part 1 done" with time used and no score; `already_submitted` after. **Part 2**: most = least impossible on the page and refused by `baseline_next`; no 2B statement in any response before the lock; lock dialog; 2A frozen afterwards (no way back, later saves ignored); "not my role" only on `allow_nr` statements; submit. **Part 3**: module from the role, server needs all 10 self-ratings, glossary dialog, 9 of 10 ratings cannot continue, CORE then module, submit; an account without a role area gets "module not set" (real). **Time up**: Parts 1 and 2 submit by themselves at 0:00 with gaps, Part 2 even before the lock (`page.clock`; real also short minutes via `/__dev/config` and the server clock moved into the grace period). |
| `rate.spec.mjs` | Manager rating: the list shows only reports (status, no scores), guide first, every statement 1–4 or N/A, values saved as they go and back after a reload, status `complete`; a non-report is `forbidden` (get and save); a learner gets the "for managers" page; with `rating_open` FALSE the list is read-only and `rate_get` / `rate_save` are `not_open`. |
| `profile.spec.mjs` | Profile closed before `results_open` (page and `not_open`); after `results_open` TRUE and `/__dev/build profiles` (real) the Part 1, 2 and 3 sections and the two IDP gaps show; manager ratings reach the learner only as charter means and flags (no item-level values; `top_dev` is statement text only; `rate_get` is `forbidden` for the learner). |
| `team.spec.mjs` | Step 6: the team page shows exactly the groups the server returned, never one under `min_n` (real roster: demand, supply and materials have 2 people each); baseline averages unpublished until `results_open`, then (after `/__dev/build summary`) only the whole team is shown with the v2 metrics (F21, specs/22); manager gate view shows passed / not yet / needs chat / not started for courses and P1/P2/P3 done / in progress / not done for the baseline, no `%`, no scores; `unlock_retake` from the API and from the "I've had the chat" button opens a third try; non-managers get no gate view and `forbidden`. |
| `capstone-panel.spec.mjs` | Step 6: SOI parts ≤ 60 words (live counter, page and server), https evidence, VND digits, save + reload; submission text is rendered as text on the panel page (no HTML injection); a judge saves five scores and a comment that persist after reload; judges cannot score their own team (mock); non-panel users get the "for the panel" page. |
| `security.spec.mjs` | Explicit `start` / `save` / resume / `me` scans and item whitelist; `?next=https://evil.example` (and `//…`, `javascript:`, encoded forms) never leaves the Hub while a relative `next` still works; only self + Google Fonts are contacted; the session stays in `sessionStorage` unless "Keep me signed in"; every page has the CSP and no inline or third-party scripts. |
| `a11y.spec.mjs` | axe (`wcag2a`, `wcag2aa`) on the sign-in page, every signed-in page, a quiz question screen and the onboarding gates, at 360 and 1280 px, light and dark; fails on serious or critical violations. |

Helpers: `helpers/accounts.mjs` (which account and course each flow uses — real tests never share an
(account, course) pair), `helpers/devapi.mjs` (Node calls to the dev server, fixture keys to answer right
or wrong on purpose), `helpers/inspect.mjs` (visible strings, language-neutral rules, overflow, axe),
`helpers/pages.mjs` (the page list), `helpers/scan.mjs` (the leak scanner).

## Known gaps

- Judges on their own team are tested in the mock only (no dev-roster judge is on a team); the server rule
  is covered by `backend/tests/api.test.js`.
- `404.html` uses absolute `/CBP27/` paths for GitHub Pages and is not tested locally.
- Part 1 form choice, equating and the profile numbers themselves are covered by `backend/tests/*.test.js`;
  the browser tests check what is shown and what is never sent.
