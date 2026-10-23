# CLAUDE.md · instructions for Claude Code in this repository

You are building and maintaining **The 1% Planner Hub**: a static web app on GitHub Pages (`docs/`) with a Google Apps Script backend (`backend/`) and a private Google Sheet. The owner is Quân, Planning Director, Marico South East Asia. Learners are 20 planners and customer-service staff in Vietnam (English to read, Vietnamese to discuss).

## Read in this order
1. `README.md`
2. `program/00_overview.md` (what the program is)
3. `specs/10_architecture.md` → `specs/11_sheet_schema.md` → `specs/12_backend_api.md` → `specs/13_hub_pages.md` → `specs/14_assessment_rules.md` → `specs/15_capstone_and_pitch.md` → `specs/16_admin_and_reports.md` → `specs/18_security_privacy_checklist.md`
4. `specs/19_build_decisions.md` (owner decisions and red-team fixes; wins over earlier specs) → `specs/20_api_contract.md` (exact request/response shapes for backend, front end and mock)
5. `specs/17_build_plan.md` (the step-by-step plan with acceptance tests). Work through it in order and tick each step.

## Hard rules
- The repository is public. Never commit learner or colleague names, employee codes, scores, answer keys, item texts or any Marico business data (sales, fill rate, lost sales, stock, budgets, internal program names). `content-private/` is in `.gitignore`; never remove that line, never move its files elsewhere in the repo.
- The browser must never receive an `answer` or `why` field before an attempt is submitted. Write a test that fails if it does.
- Vanilla HTML, CSS and JavaScript only in `docs/`. No build step, no framework, no external analytics, no third-party scripts except Google Fonts (Source Sans 3, Source Serif 4).
- Every user-facing string exists in English and Vietnamese (`docs/i18n/en.json`, `docs/i18n/vi.json`). Default language EN; a toggle switches to VI and is remembered in `localStorage` (wrapped in try/catch).
- Insert any text that came from the Sheet with `textContent` or an escape helper, never raw `innerHTML`.
- Keep the Marico look: tokens in `specs/13_hub_pages.md` (blue #014FA1, green #96C61C, ink #051C2C), light and dark mode, phone-first (360 px wide works, no horizontal scroll).
- Course codes and names are fixed: A2 Data to Decisions · A3 AI at Work · A1 The Right Question · C1 Effective Communication · P1 Line of Sight · Capacity Planning · P2 Master Production Scheduling · P3 Material Requirements Planning · P4 Demand & the Business · P5 SLOB & Inventory Health · P6 Fill Rate & Customer Service.
- The problem-solving method keeps Quân's step names exactly: Define the Problem · Break Problem into Issues · Eliminate non key issues · Issue analysis and workplan · Conduct work items · Synthesize finding from analysis · Prepare a powerful communication · ITERATE. The one-day answer is SOI (Situation, Observation, Implication), never SCQA.
- Do not use other companies' names or data anywhere.

## How to test
- Run `sh tools/install_hooks.sh` once after cloning: the pre-commit hook runs `tools/check_no_private.mjs` (CI runs it with `--all`).
- `docs/js/api.js` has a mock mode (`?mock=1`) backed by `docs/js/mock-api.js` with fake items (no real questions). Use it with Playwright (Chromium is preinstalled) to test every page at 360 px and 1280 px, EN and VI, light and dark.
- Backend logic that does not touch Google services (grading, form selection, retake timing, summaries) lives in pure functions in `backend/Logic.gs` and is tested by `backend/tests/logic.test.js` run with Node (`node backend/tests/logic.test.js`); keep those functions free of `SpreadsheetApp` calls so they run in Node.

## When you are unsure
Stop and write the question in `OPEN_QUESTIONS.md` rather than guessing about privacy, scoring rules or anything a learner will see.
