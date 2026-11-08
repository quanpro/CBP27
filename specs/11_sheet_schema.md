# 11 · Google Sheet schema ("1pct-planner-data")

Create every tab with `setupSheet()` in `backend/Setup.gs` (idempotent: creates missing tabs and header rows, never deletes data). Row 1 = headers exactly as below. Booleans are `TRUE`/`FALSE`. Timestamps are ISO strings in Asia/Ho_Chi_Minh.

## Config
| key | value |
|---|---|
| wave | `2026-11` (baseline wave id; re-test uses `2027-12`) |
| pass_mark | `0.8` |
| retake_hours | `24` |
| max_free_attempts | `2` (third attempt needs an unlock) |
| team_view_min_n | `3` |
| session_hours | `6` |
| recall_days | `2,7,30` |
| p1_open / p2_open / p3_open | `FALSE` (Baseline v2: each part open for everyone while TRUE; menu **Baseline: open or close parts…**) |
| rating_open | `FALSE` (managers and admins rate their reports) |
| results_open | `FALSE` (learners see their profile; baseline team averages publish; hourly job builds Profiles) |
| p1_live / p1_backup | `B,C` / `A` (Part 1 forms; the backup only through an Overrides row) |
| p1_minutes / p2_minutes / p3_minutes / grace_minutes | `65` / `35` / `48` / `5` |
| p2_w_sjt / p2_w_mgr | `0.5` / `0.5` (charter index weights) |
| equate_threshold_pts | `5` (equate Part 1 when live-form means differ by more than this) |

The v1 keys `baseline_open_from`, `baseline_open_to`, `baseline_minutes` and `baseline_grace_minutes` are no longer read (left in place on an existing Sheet; not created on a new one). Full list with notes: `configDefaults_()` in `backend/Data.gs` and `backend/DEPLOY.md` step 7.

## Roster (private; HR maintains)
`employee_code, display_name, role_area (demand|supply|materials|cs), is_manager, manager_code, roles (learner;manager;panel;admin), pin_hash, pin_salt, must_change_pin, failed_logins, locked_until, active, lang`, then `preferred_name, lock_count, session_ver, consent_at, certificate, lock_history` (specs/19) and `p3_module` (optional `DP|SP|RPM|CS`, overrides the Part 3 module from role_area). `manager_code` also decides who rates whom in Baseline Part 2 (Quân is the manager_code of the three managers and of his direct reports).

## Courses (import from `content-private/Courses.csv`)
`code, name_en, name_vi, self_en, self_vi, obj1_en, obj1_vi … obj6_en, obj6_vi` plus columns added by hand: `cycle, blink_url, online_from, checkpoint_close, forum_date, field_until, open (TRUE/FALSE), order, online_to`. The Sheet owns the calendar: `order` and `cycle` set the order on My learning; `online_to` ends the "On Blink" window shown on the course page. Defaults come from `docs/data/courses.json` (Seed.gs) and only fill blank cells.

## Sessions (offline sessions; the Hub's calendar of forums, Pitch Day and the War Room)
`date (YYYY-MM-DD), kind (kickoff|forum|pitch|warroom|other), courses (codes, e.g. "C1 P1"), title_en, title_vi, start (13:30), end (17:30), place, note_en, note_vi, active (TRUE/FALSE)`. Sent in `me.sessions` (active rows, oldest first). A course's forum card uses the session on its `forum_date`; its Teach stage is the first session after its field work (`field_until`). Pitch Day is the `pitch` row. Seeded once with the nine 2027 sessions when the tab is empty.

## Items (import from `content-private/Items.csv`; never exported to the repo)
`item_id, assessment (predict|checkpoint), course, form (PR|A|B), objective, case_id, stem_en, stem_vi, a_en, a_vi, b_en, b_vi, c_en, c_vi, d_en, d_vi, answer (a|b|c|d), why_en, why_vi, active`. Old `baseline` rows (v1) are ignored; the baseline lives in **BaselineItems**.

## Cases
`case_id, title_en, title_vi, context_en, context_vi` (CASE1 = "Shampoo X before Tết", from `content-private/item_bank.json` → `meta.case`)

## Attempts (one row per attempt)
`attempt_id, employee_code, assessment (predict|checkpoint|recall|baseline_p1|baseline_p2|baseline_p3), course, form, attempt_no, status (open|submitted|expired|void), started_at, last_saved_at, submitted_at, served_items (JSON array of item ids in served order), answers (JSON {item_id: option_id | {most, least} | 1..4 | "NR"}), n_items, n_correct, score_pct, by_objective (JSON), by_course (JSON; Part 1: {A1|A2|C1: {n, correct}}), passed (TRUE/FALSE/blank), wave, seed, self_ratings (JSON; Part 3 opener), graded_answers (JSON, frozen at submit)`, then for Baseline v2: `part (1|2|3), module (Part 3), section_locks (JSON {SJT: {at, answers}}: the frozen SJT answers), raw_pct, scaled_pct (Part 1, equated by buildProfiles), by_step, by_move (Part 1), by_charter (Part 2: {c: {sjt_points, sjt_max, self_mean}}), by_level, by_gate (Part 3; all {key: {n, correct}}), time_used_s, section_pct (JSON {A, B} | {SJT} | {CORE, MOD}), deadline_at (fixed at start)`. Part 2 stores SJT points in `n_correct` of `n_items` = 30 and SJT % in `score_pct`/`raw_pct`.

## SelfRatings (course self-ratings: the Baseline Part 3 opener)
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
`wave_or_course, group (all|demand|supply|materials|cs), n, metric (bl2_p1_pct|bl2_p2_sjt_pct|bl2_p2_mgr_mean|bl2_p3_core_pct, course = BL2, only while results_open | checkpoint_first_try_pass|checkpoint_pass_by_forum), course, value, updated_at, count`

## Baseline v2 tabs (specs/22 §2; private; cells plain text)

### BaselineItems
`item_id, assessment (baseline_p1|baseline_p2|baseline_p3), part, section (A|B for P1, SJT|RATE for P2, CORE|MOD for P3), module (DP|SP|RPM|CS|), item_type (mcq|sjt|rating), form (A|B|C for P1, ONE), order, case_id, exhibit_ids (;-separated), stem_en, stem_vi, a_en, a_vi, b_en, b_vi, c_en, c_vi, d_en, d_vi, answer, answer_most, answer_least, why_en, why_vi, self_en, self_vi, mgr_en, mgr_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi, allow_nr, step, move, objective, gate, level, charter (1–5|QWS), active`. Read by header name, so the column order does not matter.

### Exhibits
`exhibit_id, part, form, title_en, title_vi, md_en, md_vi` (Markdown tables and `- label: value` lists, rendered as text).

### BaselineText
`key, en, vi`. Keys: `p1_title`, `p1_sec_A`, `p1_sec_A_intro` (optional), `p1_sec_B`, `p1_sec_B_intro_<form>`, `p1_case_<form>_<C1|C2>`, `p2_title`, `p2_sec_SJT`, `p2_sec_SJT_intro`, `p2_sec_RATE`, `p2_sec_RATE_intro`, `p2_scale_1`…`p2_scale_4`, `p2_scale_na`, `p2_scale_nr`, `p2_charter_1`…`p2_charter_5`, `p2_charter_QWS`, `p2_rater_guide`, `p3_title`, `p3_intro`, `p3_sec_CORE`, `p3_sec_DP|SP|RPM|CS` (and optional `…_intro`), `p3_glossary_1`…`p3_glossary_n`.

### Ratings
`wave, ratee_code, rater_code, rater_role (self|manager), item_id, value (1–4|NA|NR), saved_at`. One row per wave, ratee, rater, role and statement (edits update the row; a cleared value is blank). Self rows are written at the Part 2 submit; a voided Part 2 blanks them.

### Overrides
`employee_code, wave, part, form, reason, by, at` (written by **Assign a Part 1 form…**; the latest row for a person, wave and part 1 wins at their next start).

### Profiles
`employee_code, wave, built_at, json` (written by `buildProfiles()`: menu, or the hourly job while results_open; rows of other waves are kept).

## Pulse (forum feedback, optional Google Form linked here)
`forum_date, nps (0–10), useful (1–5), will_use, change_next, submitted_at` (anonymous: no code column)

## Log
`ts, action, employee_code, ok, message` (no answers, no PINs)
