# 22 · Baseline v2 build decisions and API (wins over 21 where they differ)

Decided with Quân on 31 Oct 2026, after the Baseline 2026 v3 review pack. Spec 21 describes the three-part design; this file records what changes and is the exact contract for `backend/`, `docs/js/mock-api.js` and the pages. The v1 baseline (one 60-minute sitting, 46 items, Part A/B/C) is **removed**: `start {assessment: "baseline"}` returns `bad_request`.

## 1. Owner decisions (31 Oct)

| Topic | Decision |
|---|---|
| Opening | **Manual, for everyone at once.** Each part has its own switch (Config `p1_open`, `p2_open`, `p3_open`, default `FALSE`). While a switch is `TRUE`, every active roster member can start that part once per wave. No dates gate the baseline (`baseline_open_from/to` are no longer read). Closing a switch stops new starts; an attempt already in progress can still be finished until its own deadline. |
| Manager rating and profile | Built now, **opened manually later**: Config `rating_open` (managers and admins rate) and `results_open` (learners see their profile; baseline team averages publish). Both default `FALSE`. |
| Part 1 forms | Live `B,C` (Config `p1_live`), backup `A` (`p1_backup`). Backup only through an `Overrides` row. |
| Part 1 timing | **One 65-minute timer** (Config `p1_minutes = 65`) for both sections; learners move freely between Section A (22 case items) and Section B (10 logic items). No separate section lock. |
| Part 2 weights | **50 % SJT + 50 % manager** (Config `p2_w_sjt = 0.5`, `p2_w_mgr = 0.5`). |
| "Not my role" | Self form only, on the statements with `allow_nr = TRUE` in the Sheet (R03, R10, R13). An NR answer is left out of every mean. |
| Course self-ratings | Kept as the opener of Part 3 (the 10 statements and 0–4 scale from the Courses tab, as in v1). |
| Part 2 order | Fixed: 2A (SJT) first, locked, then 2B (self-rating). 2B items are not sent before 2A is locked (they describe the behaviours 2A rewards). One 35-minute timer for the whole part. |
| Part 3 | 3-minute self-rating opener + 10 CORE + 18 module items, one timer (Config `p3_minutes = 48`). Module from `Roster.p3_module`, else `role_area` (demand→DP, supply→SP, materials→RPM, cs→CS). |
| Results shown after a sitting | "Part N done" and time used only. No score, no item feedback (keeps the Dec 2027 re-test valid). |

## 2. Sheet (private; `setupSheet()` adds, never deletes)

New tabs (row 1 = these headers, all cells plain text):
- **BaselineItems**: `item_id, assessment, part, section, module, item_type, form, order, case_id, exhibit_ids, stem_en, stem_vi, a_en, a_vi, b_en, b_vi, c_en, c_vi, d_en, d_vi, answer, answer_most, answer_least, why_en, why_vi, self_en, self_vi, mgr_en, mgr_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi, allow_nr, step, move, objective, gate, level, charter, active`.
  `assessment` = `baseline_p1|baseline_p2|baseline_p3`; `section` = `A|B` (P1), `SJT|RATE` (P2), `CORE|MOD` (P3); `module` = `DP|SP|RPM|CS|` ; `item_type` = `mcq|sjt|rating`; `form` = `A|B|C` (P1) or `ONE`; `exhibit_ids` separated by `;`; `charter` = `1`–`5` or `QWS`. The v1 checkpoint/predict/recall bank stays in **Items** (its old `baseline` rows are ignored).
- **Exhibits**: `exhibit_id, part, form, title_en, title_vi, md_en, md_vi` (Markdown tables and `- label: value` lists; rendered as text, never HTML).
- **BaselineText**: `key, en, vi` — section titles and intros, case titles, glossary lines, rater guide, scale labels, charter names. Keys: `p1_title`, `p1_sec_A`, `p1_sec_B`, `p1_sec_B_intro_<form>`, `p1_case_<form>_<C1|C2>`, `p2_title`, `p2_sec_SJT`, `p2_sec_SJT_intro`, `p2_sec_RATE`, `p2_sec_RATE_intro`, `p2_scale_1`…`p2_scale_4`, `p2_scale_na` (manager form), `p2_scale_nr` (self form, "not my role"), `p2_charter_1`…`p2_charter_5`, `p2_charter_QWS`, `p2_rater_guide` (Markdown: paragraphs, `**bold**`, `*italic*`, numbered lines), `p3_title`, `p3_intro`, `p3_sec_CORE`, `p3_sec_DP`, `p3_sec_SP`, `p3_sec_RPM`, `p3_sec_CS`, `p3_glossary_1`…`p3_glossary_n`.
- **Ratings**: `wave, ratee_code, rater_code, rater_role (self|manager), item_id, value (1–4|NA|NR), saved_at`.
- **Overrides**: `employee_code, wave, part, form, reason, by, at` (Part 1 form choice for one person: backup form, re-sit after a voided attempt, a person who saw a live form).
- **Profiles**: `employee_code, wave, built_at, json` (written by `buildProfiles()`; read by `profile`).

New Roster column: `p3_module` (optional override, `DP|SP|RPM|CS`).
New Config keys (defaults): `p1_open FALSE`, `p2_open FALSE`, `p3_open FALSE`, `rating_open FALSE`, `results_open FALSE`, `p1_live B,C`, `p1_backup A`, `p1_minutes 65`, `p2_minutes 35`, `p3_minutes 48`, `grace_minutes 5`, `p2_w_sjt 0.5`, `p2_w_mgr 0.5`, `equate_threshold_pts 5`.
Attempts: `assessment` gains `baseline_p1|baseline_p2|baseline_p3`; new columns `part, module, section_locks, raw_pct, scaled_pct, by_step, by_move, by_charter, by_level, by_gate, time_used_s`.

Admin menu additions: **Baseline: open or close parts…** (one dialog: P1, P2, P3, Manager rating, Results — shows current state, writes the Config switches, refreshes the cache), **Assign a Part 1 form…** (writes an Overrides row), **Build baseline profiles** (equating + profiles; also run by the hourly trigger once `results_open` is TRUE), **Baseline v2 reports** (`Dash_BL2_Heatmap` person × area, `Dash_BL2_Items` p-value / point-biserial / distractor % per item, `Dash_BL2_Forms` starts and mean per Part 1 form, `Dash_BL2_Raters` mean and spread per rater, `Dash_BL2_Flags` blind spot / hidden strength / knowing–doing / rates-high-scores-low). **Validate items / courses** also checks BaselineItems (ids unique, each live Part 1 form 32 items, SJT most ≠ least and both present, mcq answer a–d, every rating has self/mgr text, exhibits referenced exist).

## 3. Rules

- **Once per part per wave.** A voided attempt does not count.
- **Part 1 form**: an Overrides row for (code, wave, part 1) wins. Otherwise first wave: the live form with fewer non-void starts among people with the same `role_area` in this wave; tie → `hash(code + wave)`. Re-test wave: the live form the person did not take in their previous wave (if they took the backup, the live form with fewer starts). Never the backup without an override.
- **Timers**: `deadline_at = started_at + minutes`; the server accepts submits until `deadline_at + grace_minutes`; after that a submit or the next `me`/`start` auto-submits the saved answers.
- **Scoring (server only, at submit)**:
  - P1: `raw_pct = correct ÷ 32`; `by_step`, `by_move` (`{key: {n, correct}}`), `section_A_pct`, `section_B_pct`. `scaled_pct` = mean-sigma equated to Form A's scale by `buildProfiles()` when live-form means differ by more than `equate_threshold_pts`; otherwise `scaled_pct = raw_pct`.
  - P2: per SJT item +1 most = key, +1 least = key; most = least on submit → `bad_request`. `sjt_pct` = points ÷ 30. `by_charter[c] = {sjt_points, sjt_max, self_mean}`. Self ratings (1–4, NR left out) are also written to Ratings (`rater_role = self`).
  - P3: `total_pct` of 28, `core_pct`, `module_pct`, `by_level`, `by_gate` (`{key: {n, correct}}`). Indicative level = highest of BA < WK < FO < LE where that level and all lower levels are ≥ 70 %.
  - Manager mean per charter: mean of non-NA manager ratings, shown only if ≥ 2 statements rated (QWS ≥ 3). Charter index (0–100) = `p2_w_sjt × SJT% + p2_w_mgr × (mgr_mean − 1) ÷ 3 × 100`; without a manager mean the index is `null`. Flags per charter: `blind_spot` (self − manager ≥ 1.0), `hidden_strength` (manager − self ≥ 1.0), `knowing_doing` (SJT% ≥ 67 and manager mean < 2.5). SJT% per charter is reported as a band: `low` (≤ 33), `mid` (50–67), `high` (≥ 83).
  - Course link (for "rates high, scores low" and the profile): A1 ← P1 steps 1–4; A2 ← P1 moves SHAPE, SIZE, CHECK; C1 ← P1 move SO WHAT and step 6; P1 (Line of Sight · Capacity Planning) ← P3 CORE; P2 (MPS) ← P3 SP module; P3 (MRP) and P5 (SLOB) ← P3 RPM module; P4 (Demand) ← P3 DP module; P6 (Fill rate) ← P3 CS module; A3 has no score. A course whose module the person did not take has `score_pct: null`. Flag when self-rating ≥ 3 and the linked score < 50 %.
  - IDP gaps: the two lowest of these areas: P1 Section A, P1 Section B, each P2 charter index (or SJT% if no index), P3 core, P3 module. Ties → lower self-rating, then the order listed.
- **Rating**: rater ↔ ratee from `Roster.manager_code` (Quân is the manager_code of the 3 managers and his direct reports). Test users and inactive people are not listed. One set per rater–ratee–wave, editable while `rating_open`. NA allowed (manager form only).
- **Privacy**: no response ever contains `answer`, `answer_most`, `answer_least`, `why_en`, `why_vi`, `step`, `move`, `gate`, `level` or `charter` for an item before or after a sitting. Learners never see their manager's item-level ratings, only charter means and flags in the profile. Profile and baseline team numbers only while `results_open` is TRUE.

## 4. API (replaces the baseline parts of 20)

### Served item shapes
```
BMcq    { item_id, type: "mcq", section: "A"|"B"|"CORE"|"MOD", case_id, exhibit_ids: [id], stem_en, stem_vi, options: [Option×4] }   // options shuffled per attempt
BSjt    { item_id, type: "sjt", stem_en, stem_vi, options: [Option×4] }                                                                // shuffled per attempt
BRating { item_id, type: "rating", text_en, text_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi, allow_nr }                       // self wording
```

### `me` → `baseline`
```
baseline: {
  wave,
  parts: { p1: PartState, p2: PartState, p3: PartState },
  results_open, profile_ready,                 // profile_ready = results_open and at least one part submitted
  rating: { open, to_rate, done } | null,      // managers/admins only
  previous?: { wave, parts_done: [1,2,3] }
}
PartState { open, status: "not_started"|"in_progress"|"submitted", minutes, n_items, attempt_id?, started_at?, deadline_at?, submitted_at?, form? }
```
`open` = the Config switch. `team_status` reports `baseline: { p1, p2, p3 }` with `"done"|"in_progress"|"not_done"`.

### `start {token, assessment: "baseline_p1"|"baseline_p2"|"baseline_p3"}`
Errors: `not_open` (switch off and no attempt in progress), `already_submitted` (this part done this wave). Resumes an open attempt (`resumed: true`).
```
{ attempt_id, assessment, part, form, module, started_at, deadline_at, time_limit_min, resumed,
  answers: { item_id: "a".."d" | {most, least} | 1..4 | "NR" },
  self_ratings?: { A2: 0..4, … },                                   // part 3
  sections: [ { id, title_en, title_vi, intro_en, intro_vi, locked, items: [BMcq|BSjt|BRating] } ],
  exhibits: { id: { title_en, title_vi, md_en, md_vi } },           // part 1 and part 3 (only those the served items reference)
  cases?: { C1: { title_en, title_vi }, C2: {…} },                  // part 1
  glossary?: { en: [line], vi: [line] },                            // part 3
  self?: [ {course, en, vi} ], scale?: [ {level, en, vi, desc_en, desc_vi} ],   // part 3 opener, as v1
  rating_scale?: { points: [ {v, en, vi} ], nr: {en, vi} } }        // part 2
```
Part 1: sections `A`, `B` (both with items). Part 2: section `SJT` with items and section `RATE` with `items: []` until SJT is locked; once locked, `SJT.locked = true` (its items still sent so the page can show what was chosen) and `RATE.items` filled. Part 3: sections `CORE`, `MOD`.

### `baseline_next {token, attempt_id, answers}` (part 2 only) → `{ locked: ["SJT"], section: { id: "RATE", …, items: [BRating] } }`
Saves the answers, requires all 15 SJT items with both picks and most ≠ least (`bad_request {field: item_id}` otherwise), then freezes them: later `save`/`submit` cannot change SJT answers.

### `save {token, attempt_id, answers, self_ratings?}` → `{saved_at}` · `submit {…}` → `{ assessment, part, submitted_at, time_used_s }`
Submit checks: part 2 needs SJT locked and every rating answered (1–4, or NR where `allow_nr`); part 3 needs all 10 self-ratings. A server-side expiry submits what was saved without those checks. Idempotent.

### `rate_list {token}` → manager/admin only
`{ open, wave, reports: [ { code, first_name, role_area, status: "not_started"|"in_progress"|"complete", saved_at } ] }`

### `rate_get {token, ratee}` → `{ open, ratee: {code, first_name}, guide_en, guide_vi, scale: { points: [{v,en,vi}], na: {en,vi} }, items: [ {item_id, text_en, text_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi} ], values: { item_id: 1..4|"NA" }, saved_at }`  (manager wording)
### `rate_save {token, ratee, values}` → `{ saved_at, complete }`
Errors: `not_open` (rating closed), `forbidden` (not your report).

### `profile {token}` → `not_open` unless `results_open`
```
{ wave, built_at,
  p1: { form, raw_pct, scaled_pct, section_A_pct, section_B_pct, by_step: {key: pct}, by_move: {key: pct} } | null,
  p2: { sjt_pct, self_mean, mgr_mean, by_charter: { "1": { name_en, name_vi, sjt_band, self_mean, mgr_mean, index, flags: [..] }, … }, top_dev: [ {item_id, text_en, text_vi} ×2 ] } | null,
  p3: { module, total_pct, core_pct, module_pct, by_level: {BA: pct, …}, by_gate: {key: pct}, level } | null,
  courses: { A2: { self, score_pct|null, flag } , … },
  gaps: [ { area, name_en, name_vi, pct } ×2 ] }
```
`top_dev` = the two statements with the lowest manager rating (tie → largest self − manager gap); empty without manager ratings.

### `team_summary` → `baseline_published` = `results_open`; `baseline` groups become `{ group, n, p1_pct, p2_sjt_pct, p2_mgr_mean, p3_core_pct }` (n ≥ `min_n`, managers and test users left out).

## 5. Demo mode
Invented items only (`MOCK-BL-…` ids), 6 per Part 1 section, 4 SJT, 6 ratings (one with `allow_nr`), 3 CORE + 4 per module, two invented exhibits, a 3-line glossary. All three parts open in the demo; `DEMO-L` has done all three and `results_open` is on (profile visible); `DEMO-M` and `DEMO-N` can take every part; `DEMO-M` can rate `DEMO-L` and `DEMO-N` (rating open). Demo timers: P1 10 min, P2 6 min, P3 8 min.
