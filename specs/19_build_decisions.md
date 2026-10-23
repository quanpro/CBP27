# 19 · Build decisions (Oct 2026)

Decisions taken with Quân before the build, plus fixes for the risks a red-team review found in specs 10–18. Where this file and an earlier spec disagree, **this file wins**. Exact request and response shapes are in `20_api_contract.md`.

## Owner decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | Build specs 10–18 as written, with the changes below. |
| D2 | Repository and URL | Public repo `quanpro/CBP27`, GitHub Pages from `main` `/docs` → `https://quanpro.github.io/CBP27/`. Every link in the Hub is relative, so a rename does not break it. |
| D3 | Branding | "The 1% Planner" · "Better every week" / "Mỗi tuần tốt hơn một chút", small label "Capability Building Program 2027" / "Chương trình phát triển năng lực 2027". Marico logo. |
| D4 | Blink videos | Support both. Each episode has a row in the new **Episodes** tab with `blink_url` (opens Blink) and an optional `embed_url` (played in an iframe inside the Hub). If `embed_url` is blank, or the frame fails to load within 8 s, the Hub shows a "Watch on Blink" card instead. URLs live only in the Sheet. Episode titles (public) live in `docs/data/courses.json`. |
| D5 | Answer keys before a pass | A checkpoint that is **not yet** passed shows the objectives to revisit, the episodes to rewatch and the missed questions with **the learner's own answer only**. The correct option and the "why" appear once the learner has passed that course, or after the course's late window closes (`forum_date + late_days`). Predict always shows answers (ungraded, separate PR items). Recall shows answers (the learner has passed). |
| D6 | "Why" lines | 194 predict/checkpoint items had no explanation. Claude drafts EN + VI lines privately (never in this repo); Quân reviews them and imports them into the Sheet. The Hub shows them automatically. |
| D7 | Field sign-offs | Not tracked in the Hub; they stay in the HR system. Certificates show what the Hub knows (checkpoints, capstone submitted) and an admin-set `certificate` level in Roster. |
| D8 | Team view | Minimum group size 3 as in spec 14 (`team_view_min_n`), managers and test users excluded. |
| D9 | Extras | Episode list with self-ticked "watched" (saved to the Sheet) · certificate path tracker (Practitioner → Expert → Coach) · private "1% a week" streak and the 1.01^weeks meter. No leaderboards, no other people's names or scores. |
| D10 | Demo mode | If `docs/config.js` has an empty `GAS_URL`, or the URL has `?mock=1`, the Hub runs on `docs/js/mock-api.js` with invented questions and a visible "Demo" banner. The team can try every page before the backend is deployed. |

## Fixes for red-team findings

| # | Risk | Fix |
|---|---|---|
| F1 | CacheService can evict tokens early (6 h is its maximum) | Stateless signed token: `v1.<payload>.<HMAC-SHA256>` with the secret in Script Properties (`TOKEN_SECRET`). Payload `{c: code, e: expiry ms, v: session_ver}`. `session_ver` in Roster increases on a PIN change or reset, which logs out every device. |
| F2 | PIN hashes in a Sheet can be brute-forced offline (only 10⁶ PINs) | `pin_hash = SHA-256(PIN_PEPPER + ":" + salt + ":" + pin)`, pepper in Script Properties, not in the Sheet. 5 failures → 15-min lock; each further lock in the same day doubles (15, 30, 60 … max 24 h). Unknown codes return the same `auth_failed` as a wrong PIN. |
| F3 | `must_change_pin` enforced only in the page | Enforced on the server: every action except `login`, `change_pin` and `me` returns `pin_change_required`. |
| F4 | Lock contention from autosave | Answers are kept in `localStorage` first (keyed by attempt). `save` is debounced (on change, at most every 20 s, and on page hide) and writes only its own Attempts row without the script lock; `login`, `start`, `submit` and every append use `LockService` (tryLock 10 s → `busy`, which the client retries). |
| F5 | Sheets type coercion (`2026-11` → date, `00123` → 123) | `setupSheet()` sets the spreadsheet time zone to Asia/Ho_Chi_Minh and formats every column as plain text (`@`). The backend writes and reads strings; times are ISO with offset (`2026-11-16T09:30:00+07:00`), dates `YYYY-MM-DD`. Booleans are read leniently (`TRUE`, `true`, `1`). |
| F6 | Items larger than one cache value (100 KB) | Cache items per assessment/course/form, Courses and Config for 10 min; `me` is never cached across people. |
| F7 | Clocks | Every response carries `server_now`. Timers use `deadline_at` from the server. Date windows end at 23:59:59 +07:00. |
| F8 | Baseline abandoned or submitted late | Server grace 10 min after the 60-min limit. After that the attempt is graded from the last save (`status = expired`) the next time the learner calls `me`, `start` or `submit`, so nobody is locked out of their one attempt. Part A must be complete before Part B opens, so an auto-submit always has the self-ratings. |
| F9 | Option order changing on reload | Option order is derived from a per-attempt `seed` stored in Attempts, so `start` (resume) returns the same order. `start` always resumes an open attempt instead of creating a new one. |
| F10 | Roster row parity is fragile (sorting changes it, same form first in all 10 courses) | `pickForm`: the first attempt goes to the form with fewer first attempts so far in that course (exact balance); a tie is broken by a hash of code + course. Later attempts alternate. |
| F11 | Recall after a late pass | Recall dates are `max(forum_date, pass date) + 2/7/30 days`. One submit per Recall row; three different items per day from the form not taken. |
| F12 | Vietnamese names start with the family name | New Roster column `preferred_name`. The greeting uses it; if blank, the **last** word of `display_name`. |
| F13 | Checkpoint after it closes | Spec 14 says late learners finish "in the following week with the manager": the checkpoint stays open until `forum_date + late_days` (Config `late_days = 7`). After that, a new attempt needs an Unlocks row. Each Unlocks row grants one extra attempt. |
| F14 | Capstone team creation | Quân/HR create teams in a new **Teams** tab (`team_id, project_title, members, sponsor_code, active`). Only listed members can submit for their team. |
| F15 | Course order | Calendar order comes from a new `order` column in Courses: A2, A3, A1, P1, C1, P2, P3, P4, P5, P6. |
| F16 | Error pages break CORS | `doPost` wraps everything in try/catch and always returns JSON; the client only sends `Content-Type: text/plain;charset=utf-8` and no credentials. |
| F17 | Third-party content | A Content-Security-Policy `<meta>` limits scripts to the Hub itself, fonts to Google Fonts, network calls to `script.google.com` / `script.googleusercontent.com`, frames to `https:` (Blink embeds). |
| F18 | Privacy notice | First login shows who sees what (from `about.html`) and records `consent_at` in Roster. |
| F19 | Test users | Roster `roles` containing `test` are excluded from every summary, team view and gate report. |
| F20 | Weighting | Pitch Day score = (c1 + c2 + c3 + c4 + 2·c5) / 6; capstone = (c1 + c2 + 2·c3 + 2·c4 + c5) / 7; team score = mean of judges. Computed in the Sheet (admin), never shown on the Hub. |

## Still open (see `OPEN_QUESTIONS.md`)
IT reachability test (W45) including `script.googleusercontent.com` and `fonts.gstatic.com`; whether Blink links can be embedded; HR/IT/Legal sign-off for storing learner results in Quân's Google account (Vietnam Decree 13/2023 on personal data); employee code format (the Hub accepts 3–20 letters, digits, `-` or `_`).
