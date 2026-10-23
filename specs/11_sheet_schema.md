# 11 · Google Sheet schema ("1pct-planner-data")

Create every tab with `setupSheet()` in `backend/Setup.gs` (idempotent: creates missing tabs and header rows, never deletes data). Row 1 = headers exactly as below. Booleans are `TRUE`/`FALSE`. Timestamps are ISO strings in Asia/Ho_Chi_Minh.

## Config
| key | value |
|---|---|
| wave | `2026-11` (baseline wave id; re-test uses `2027-12`) |
| baseline_open_from / baseline_open_to | `2026-11-16` / `2026-11-27` (re-test `2027-11-29` / `2027-12-10`) |
| pass_mark | `0.8` |
| retake_hours | `24` |
| max_free_attempts | `2` (third attempt needs an unlock) |
| team_view_min_n | `3` |
| session_hours | `6` |
| baseline_minutes | `60` |
| recall_days | `2,7,30` |

## Roster (private; HR maintains)
`employee_code, display_name, role_area (demand|supply|materials|cs), is_manager, manager_code, roles (learner;manager;panel;admin), pin_hash, pin_salt, must_change_pin, failed_logins, locked_until, active, lang`

## Courses (import from `content-private/Courses.csv`)
`code, name_en, name_vi, self_en, self_vi, obj1_en, obj1_vi … obj6_en, obj6_vi` plus columns added by hand: `cycle, blink_url, online_from, checkpoint_close, forum_date, field_until, open (TRUE/FALSE)`

## Items (import from `content-private/Items.csv`; never exported to the repo)
`item_id, assessment (baseline|predict|checkpoint), course, form (BL|PR|A|B), objective, case_id, stem_en, stem_vi, a_en, a_vi, b_en, b_vi, c_en, c_vi, d_en, d_vi, answer (a|b|c|d), why_en, why_vi, active`

## Cases
`case_id, title_en, title_vi, context_en, context_vi` (CASE1 = "Shampoo X before Tết", from `content-private/item_bank.json` → `meta.case`)

## Attempts (one row per attempt)
`attempt_id, employee_code, assessment, course, form, attempt_no, status (open|submitted|expired), started_at, last_saved_at, submitted_at, served_items (JSON array of item ids in served order), answers (JSON {item_id: option_id}), n_items, n_correct, score_pct, by_objective (JSON), by_course (JSON, baseline only), passed (TRUE/FALSE/blank), wave`

## SelfRatings (baseline Part A)
`employee_code, wave, course, level (0–4), submitted_at`

## Unlocks (third and later checkpoint attempts)
`employee_code, course, unlocked_by, unlocked_at, reason`

## Recall
`employee_code, course, due_date, day (2|7|30), status (due|done), score_pct, done_at`

## Capstone
`team_id, project_title, members (employee codes, ;-separated), sponsor_code, soi_situation, soi_observation, soi_implication, kpi_name, kpi_before, kpi_after, kpi_unit, evidence_url, value_vnd, value_basis, lessons, submitted_by, submitted_at, stage (pitch|capstone)`

## PanelScores
`team_id, stage, judge_code, c1_problem, c2_structure, c3_result, c4_value, c5_communication, comment, scored_at`

## Summary (written by `buildSummary()`, read by `team_summary`)
`wave_or_course, group (all|demand|supply|materials|cs), n, metric (self|baseline_pct|checkpoint_first_try_pass|checkpoint_pass_by_forum), course, value, updated_at`

## Pulse (forum feedback, optional Google Form linked here)
`forum_date, nps (0–10), useful (1–5), will_use, change_next, submitted_at` (anonymous: no code column)

## Log
`ts, action, employee_code, ok, message` (no answers, no PINs)
