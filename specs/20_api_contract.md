# 20 · API contract (front end ⇄ Apps Script ⇄ mock)

This file is the single source of truth for request and response shapes. `backend/` implements it, `docs/js/mock-api.js` imitates it, and `docs/js/api.js` calls it. It refines `12_backend_api.md` with the decisions in `19_build_decisions.md`.

## Transport
- `POST GAS_URL` with body `JSON.stringify({action, token?, ...params})` and header `Content-Type: text/plain;charset=utf-8`. No other headers, no credentials.
- Every response is JSON with `server_now` (ISO, +07:00):
  - success `{ "ok": true, "server_now": "…", ...data }`
  - failure `{ "ok": false, "server_now": "…", "error": { "code": "…", "message": "…", ...extra } }`
- Error codes: `bad_request` · `auth_failed` · `locked` (extra `until`) · `session_expired` · `pin_change_required` · `pin_weak` · `not_open` (extra `opens_at?`) · `gate_closed` · `retake_too_soon` (extra `next_retake_at`) · `unlock_needed` · `already_submitted` · `already_passed` · `not_due` · `not_found` · `forbidden` · `consent_required` (privacy notice not yet acknowledged) · `busy` (lock timeout; client retries) · `server_error`. Some errors carry one extra field: `bad_request.field`, `not_due.due_date`, `gate_closed.deadline` (capstone).
- Times are ISO strings with `+07:00`. Dates are `YYYY-MM-DD`. Percentages are integers 0–100 (`score_pct`).
- `lang` values: `en` | `vi`. Course codes: `A2 A3 A1 P1 C1 P2 P3 P4 P5 P6` (calendar order).
- Served items **never** contain `answer`, `why_en`, `why_vi`, `correct` or `mockCorrect`.

## Shared shapes
```
Profile   { code, first_name, role_area, is_manager, roles: ["learner","manager","panel","admin"], lang, must_change_pin, consent_needed, certificate }
          // first_name = Roster.preferred_name, else last word of display_name. certificate: "" | "practitioner" | "expert" | "coach"
Option    { id: "a"|"b"|"c"|"d", en, vi }
Item      { item_id, course, objective, case_id, stem_en, stem_vi, options: [Option×4] }   // options in served (shuffled) order
ReviewRow { item_id, course, objective, stem_en, stem_vi, your: Option|null, correct: Option|null, why_en, why_vi, is_correct }
          // correct/why_* are null/"" when the key is not revealed (decision D5)
```

## Actions

### `login` `{code, pin}` → `{token, expires_at, profile: Profile, me?}`
`me` (F31) is the same object the `me` action returns, without `ok` and `server_now`: the Hub keeps it like any other `me` and draws the dashboard without a second call. It is left out if building it failed (the Hub then calls `me`); the demo does not send it.

Code is trimmed and upper-cased. Errors: `auth_failed` (unknown code, inactive, wrong PIN), `locked {until}`.

### `change_pin` `{token, old_pin, new_pin}` → `{token, expires_at, profile}`
New PIN: 6 digits, not all the same digit, not `123456`/`654321`, not equal to the old PIN. Bumps `session_ver` (other devices log out) and clears `must_change_pin`. Errors: `auth_failed` (old PIN wrong), `pin_weak`.

### `consent` `{token}` → `{consent_at}`  ·  `set_lang` `{token, lang}` → `{lang}`  ·  `logout` `{token}` → `{}`
`logout` bumps `session_ver`: the token (and any other device's) stops working. Until `consent` is called, every action except login, change_pin, me, consent, set_lang and logout returns `consent_required`.

### `me` `{token}` → journey
```
{
  profile: Profile,
  baseline: BaselineState,                             // Baseline v2: see "Baseline v2" below (specs/22)
  courses: [ {                                         // calendar order
    code, order, cycle, open, online_from, online_to, checkpoint_close, forum_date, field_until, late_until,   // order/cycle/dates: the Sheet's Courses tab
    blink_url,                                         // course playlist link (may be "")
    episodes: [ { ep, minutes, blink_url, embed_url, watched } ],   // ep 0 = trailer
    predict:    { done, attempts, last_pct },
    checkpoint: { status: "not_started"|"in_progress"|"not_yet"|"passed",   // reveal of correct answers: only once passed (D5)
                  attempts, best_pct, passed_at, next_retake_at, needs_unlock, gate_closed,
                  open_attempt_id, last_attempt_id },
    recall: [ { day: 2|7|30, due_date, status: "upcoming"|"due"|"done", score_pct, attempt_id } ]
  } ],
  capstone: { team_id, project_title, pitch_submitted_at, capstone_submitted_at, pitch_deadline, capstone_deadline },
  sessions: [ { date, kind: "kickoff"|"forum"|"pitch"|"warroom"|"other", courses: [code], title_en, title_vi,
                start, end, place, note_en, note_vi } ],   // Sessions tab, active rows, oldest first (F30)
  charters: [ { n: 1..5, en, vi } ],                        // charter names from BaselineText p2_charter_1…5 (My path); [] when not set
  streak:   { current_weeks, active_this_week, active_weeks_total, multiplier, weeks_total_program: 52, recent: [bool×12] },
            // multiplier = 1.01^active_weeks_total (2 dp); recent = last 12 weeks, oldest first; Config streak_skip_weeks (e.g. Tết) neither break nor add
  certificates: { level: Profile.certificate, checkpoints_passed, checkpoints_total: 10, pitch_submitted, capstone_submitted }
}
```
`open` = the Courses `open` flag is TRUE and today ≥ `online_from`. `late_until` = `forum_date + late_days`.

### `watch` `{token, course, ep, watched: true|false}` → `{course, watched: [ep, …]}`

### `start` `{token, assessment, course?, day?}`
`assessment`: `predict` | `checkpoint` | `recall` (recall needs `course` and `day`) | `baseline_p1` | `baseline_p2` | `baseline_p3` (shapes in "Baseline v2" below). The v1 `baseline` is removed and returns `bad_request`. Resumes the open attempt if one exists (`resumed: true`, saved `answers` returned).
```
{ attempt_id, assessment, course, form, attempt_no, started_at, resumed,
  answers: {item_id: option_id},
  items: [Item] }
```
Rules (spec 14 + decisions):
- predict: course open; unlimited; 3 items.
- checkpoint: course open → `not_open`; already passed → `already_passed`; last submit < 24 h → `retake_too_soon`; attempt ≥ 3 without an unused Unlocks row → `unlock_needed`; after `late_until` without an unused unlock → `gate_closed`. 10 items.
- recall: a Recall row for that course and day with `due_date ≤ today` and status `due` → else `not_due`. 3 items.

### `save` `{token, attempt_id, answers, self_ratings?}` → `{saved_at}`
Owner only, attempt open, no script lock. `self_ratings` only for `baseline_p3`. Errors: `already_submitted` (also once a baseline part's deadline + grace has passed), `not_found`.

### `submit` `{token, attempt_id, answers, self_ratings?}` → result
Unanswered = wrong. Idempotent: submitting an already-submitted attempt returns the stored result.
```
baseline_p1|p2|p3: { assessment, part, submitted_at, time_used_s }                                  // no score, no item feedback
checkpoint: { assessment, course, form, attempt_no, n_items, n_correct, score_pct, passed, reveal,
              by_objective: { "1": {n, correct}, … }, weak_objectives: [3, 5],
              missed: [ReviewRow], next_retake_at, needs_unlock, forum_date, recall_dates?: [date×3] }
predict:    { assessment, course, n_items, n_correct, score_pct, review: [ReviewRow] }            // reveal always
recall:     { assessment, course, day, n_items, n_correct, score_pct, review: [ReviewRow] }       // reveal always
```
Baseline checks at submit: see "Baseline v2" below.

### `review` `{token, attempt_id}` → the same result shape as `submit`, recomputed now (so `reveal` can turn true later). Own submitted attempts only.

### `team_summary` `{token}` → averages (any signed-in user)
```
{ updated_at, min_n, wave, baseline_published, baseline_publish_after: null,
  baseline:    [ { group: "all"|"demand"|"supply"|"materials"|"cs", n, p1_pct, p2_sjt_pct, p2_mgr_mean, p3_core_pct } ],
  checkpoints: [ { group, n, courses: { A2: {first_try_pass: 60, passed_by_forum: 90, n_first_try, n_by_forum}, … } } ] }
```
Groups with n < `min_n` are left out; a metric counted for fewer than `min_n` people is `null`; managers and test users are never counted. `baseline_published` = Config `results_open`; baseline groups stay empty while it is FALSE (`baseline_publish_after` is always `null` now: no dates gate the baseline). `p1_pct` uses the equated Part 1 score, `p2_mgr_mean` is the person's mean manager rating (1–4, 1 dp), `p3_core_pct` the Part 3 core score. A course's checkpoint metrics stay `null` until its late window has closed (decision F21). Both come from the Summary tab (built hourly by `buildSummary`, never on a request).

### `team_status` `{token}` → manager only (`forbidden` otherwise)
`{ reports: [ { code, first_name, baseline: { p1, p2, p3: "done"|"in_progress"|"not_done" }, courses: { A2: "passed"|"needs_chat"|"not_yet"|"not_started", … } } ] }` — no scores; reports who are managers are not listed. `needs_chat` = not passed, no open attempt, and the free attempts are used up (or the late window has closed) with no unused unlock.

### `unlock_retake` `{token, code, course, note}` → `{unlocked_at}` (manager only)
Records the 15-minute coaching chat as an Unlocks row (one extra attempt). `forbidden` unless `code` is the caller's active direct report and not a manager; `bad_request` (`field: "course"`) when that course does not need a chat now. The note is stored, never logged.

### `capstone_get` `{token}` → `{ team: {team_id, project_title, members: [{code, first_name}], sponsor: {code, first_name}} | null, submissions: { pitch: Submission|null, capstone: Submission|null }, deadlines: {pitch, capstone} }`
### `capstone_submit` `{token, stage: "pitch"|"capstone", team_id, fields}` → `{submitted_at, submission: Submission}`
```
Submission { project_title, soi_situation, soi_observation, soi_implication, kpi_name, kpi_before, kpi_after, kpi_unit,
             evidence_url, value_vnd, value_basis, lessons, submitted_by, submitted_at, stage }
```
Validation: caller is a member of `team_id`; stage deadline not passed (`gate_closed`); each SOI field ≤ 60 words; `evidence_url` empty or `https://…`; `value_vnd` digits only.

### `panel_list` `{token, stage}` → panel/admin only
`{ stage, teams: [ { team_id, project_title, is_sponsor, submission: Submission|null, my_score: {c1..c5, comment, scored_at}|null } ] }`
### `panel_score` `{token, stage, team_id, scores: {c1..c5: 1–5}, comment}` → `{scored_at}` (`forbidden` for a judge who is a member of that team)

## Baseline v2 (`specs/22_baseline_v2_build.md` is the source; final shapes as built)
Three parts, each opened for everyone by a Config switch (`p1_open`, `p2_open`, `p3_open`; no dates), once per part per wave (a voided attempt does not count), one timer per part (`p1_minutes` 65, `p2_minutes` 35, `p3_minutes` 48) plus `grace_minutes` 5. The deadline is fixed at start (`Attempts.deadline_at`): a later Config change does not move a sitting in progress. After deadline + grace, `save` returns `already_submitted` and the next `me`, `start`, `submit`, `baseline_next` or `profile` grades the last save (`status: expired`, `submitted_at` = deadline + grace, `time_used_s` = the full timer).

**Served item shapes** (whitelists; never `answer`, `answer_most`, `answer_least`, `why_*`, `step`, `move`, `gate`, `level`, `charter`, `objective`):
```
BMcq    { item_id, type: "mcq", section: "A"|"B"|"CORE"|"MOD", case_id, exhibit_ids: [id], stem_en, stem_vi, options: [Option×4] }   // options shuffled per attempt (same order on resume)
BSjt    { item_id, type: "sjt", stem_en, stem_vi, options: [Option×4] }
BRating { item_id, type: "rating", text_en, text_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi, allow_nr }                       // self wording
```

**`me.baseline`** (`BaselineState`)
```
{ wave, parts: { p1: PartState, p2: PartState, p3: PartState },
  results_open, profile_ready,                 // profile_ready = results_open and at least one part submitted this wave
  rating: { open, to_rate, done } | null,      // managers and admins only: to_rate = number of people they rate, done = complete sets
  previous?: { wave, parts_done: [1,2,3] } }   // latest earlier wave with a submitted part
PartState { open, status: "not_started"|"in_progress"|"submitted", minutes, n_items,
            attempt_id?, started_at?, deadline_at? (in progress), submitted_at? (submitted), form? (part 1) }
```

**`start {token, assessment: "baseline_p1"|"baseline_p2"|"baseline_p3"}`** → errors `not_open` (switch off and no attempt in progress; no `opens_at`), `already_submitted`, `not_found` (no items; Part 3 without a module).
```
{ attempt_id, assessment, part, form ("B"|"C"|"A" for part 1, else "ONE"), module ("DP"|"SP"|"RPM"|"CS" for part 3, else ""),
  started_at, deadline_at, time_limit_min, resumed,
  title_en, title_vi, intro_en, intro_vi,                          // BaselineText p<N>_title / p<N>_intro ("" when missing)
  answers: { item_id: "a".."d" | {most, least} | 1..4 | "NR" },
  sections: [ { id, title_en, title_vi, intro_en, intro_vi, locked, items: [BMcq|BSjt|BRating] } ],
  exhibits: { id: { title_en, title_vi, md_en, md_vi } },          // parts 1 and 3: only those the served items reference
  cases: { C1: { title_en, title_vi }, C2: {…} },                  // part 1 (BaselineText p1_case_<form>_<case>)
  glossary: { en: [line], vi: [line] },                            // part 3 (p3_glossary_1…n)
  self_ratings: { A2: 0..4, … }, self: [ {course, en, vi} ], scale: [ {level, en, vi, desc_en, desc_vi} ],   // part 3 opener
  rating_scale: { points: [ {v: 1..4, en, vi} ], nr: {en, vi} } }  // part 2
```
Sections: Part 1 `A` (title `p1_sec_A`, intro `p1_sec_A_intro` if present), `B` (`p1_sec_B`, intro `p1_sec_B_intro_<form>`); Part 2 `SJT` and `RATE` (`RATE.items` is `[]` until the SJT is locked; then `SJT.locked = true`, its items still sent); Part 3 `CORE` and `MOD` (title `p3_sec_<module>`). Items are ordered by section, `order`, `item_id`. Part 1 form: an `Overrides` row for (code, wave, part 1) wins (the only way to the backup); re-test wave: the live form not taken last wave; otherwise the live form with fewer non-void starts in the person's `role_area` this wave (test users not counted), tie → hash(code + wave). Part 3 module: `Roster.p3_module`, else `role_area` (demand→DP, supply→SP, materials→RPM, cs→CS).

**`baseline_next {token, attempt_id, answers}`** (part 2) → `{ locked: ["SJT"], section: { id: "RATE", title_*, intro_*, locked: false, items: [BRating] } }`. Saves the answers first, then requires every SJT item with both picks and most ≠ least (`bad_request {field: item_id}`), then freezes them (stored in `Attempts.section_locks`). Idempotent once locked. Errors: `bad_request` (not part 2), `already_submitted`, `not_found`.

**`save`** keeps answers of the right type only; Part 2: SJT answers after the lock and rating answers before it are ignored. **`submit`** checks: Part 2 needs the SJT locked (`bad_request {field: "SJT"}`) and every statement answered, 1–4 or `NR` where `allow_nr` (`bad_request {field: item_id}`); Part 3 needs all 10 self-ratings (`{field: "self_ratings"}`). A server-side expiry grades the last save without these checks. Unanswered = wrong; an SJT item with most = least scores 0. Result: `{ assessment, part, submitted_at, time_used_s }` (idempotent; `review` returns the same).

**`rate_list {token}`** (manager or admin, `forbidden` otherwise) → `{ open, wave, reports: [ { code, first_name, role_area, status: "not_started"|"in_progress"|"complete", saved_at } ] }`. Reports = active, non-test people whose `Roster.manager_code` is the caller (managers included). Works while rating is closed (read only).
**`rate_get {token, ratee}`** → `{ open, ratee: {code, first_name}, guide_en, guide_vi, scale: { points: [{v, en, vi}], na: {en, vi} }, items: [ {item_id, text_en, text_vi, anchor1_en, anchor1_vi, anchor4_en, anchor4_vi} ], values: { item_id: 1..4|"NA" }, saved_at }` (manager wording). Errors: `forbidden` (not your report), `not_open` while `rating_open` is FALSE (the statements describe what the SJT rewards, and raters sit Part 2 too).
**`rate_save {token, ratee, values}`** → `{ saved_at, complete }`. Partial saves allowed; `null`/`""` clears a value; values 1–4 or `"NA"` (`bad_request {field: item_id}` otherwise). Errors: `not_open`, `forbidden`.

**`profile {token}`** → `not_open` unless `results_open`; `not_found` when the person has nothing this wave. Read from the Profiles tab (built by `buildProfiles()`); before the first build it is computed for that person on the request.
```
{ wave, built_at,
  p1: { form, raw_pct, scaled_pct, section_A_pct, section_B_pct, by_step: {step: pct}, by_move: {move: pct} } | null,
  p2: { sjt_pct, self_mean, mgr_mean,
        by_charter: { "1"…"5", "QWS": { name_en, name_vi, sjt_band: "low"|"mid"|"high"|null, self_mean, mgr_mean, index, flags: ["blind_spot"|"hidden_strength"|"knowing_doing"] } },
        top_dev: [ {item_id, text_en, text_vi} ×≤2 ] } | null,       // text = self wording
  p3: { module, total_pct, core_pct, module_pct, by_level: {BA: pct, …}, by_gate: {gate: pct}, level: "BA"|"WK"|"FO"|"LE"|null } | null,
  courses: { A2: { self: 0..4|null, score_pct: int|null, flag: bool }, … },   // calendar order; flag = rates high (≥ 3), scores low (< 50)
  gaps: [ { area, name_en, name_vi, pct } ×≤2 ] }
```
Means are 1 dp. `mgr_mean` per charter needs ≥ 2 rated statements (QWS ≥ 3), else `null`; index = `p2_w_sjt × SJT% + p2_w_mgr × (mgr − 1) ÷ 3 × 100`, `null` without a manager mean; QWS has no SJT items, so its index is the manager part alone and its `sjt_band` is `null`. `p2` is present when the person sat Part 2 or has manager ratings. `area` ids: `p1_A`, `p1_B`, `p2_<charter>` (index, else SJT %), `p3_core`, `p3_mod`; names from BaselineText (`p1_sec_A`, `p1_sec_B`, `p2_charter_<c>`, `p3_sec_CORE`, `p3_sec_<module>`). Gap ties → lower self-rating (P1 sections: mean course self-rating of A1, A2, C1; charters: own mean; P3 core: P1; P3 module: its linked courses), then the order listed. Learners never see item-level manager ratings.

## Demo mode (`docs/js/mock-api.js`)
Same actions and shapes, state in `localStorage` (`hub.mock.v1`). Invented items only (`MOCK-…` ids, a `mockCorrect` field that is stripped before items reach page code). Demo accounts: `DEMO-L` (learner), `DEMO-M` (manager + panel), `DEMO-N` (first login, must change PIN), all with PIN `270127`. The demo calendar is the real one moved so that the day the demo is seeded sits in cycle 2: the A2 + A3 forum was 9 days earlier, A1 has been online for 4 days, P1 … P6 open later (locked until their `online_from`), and the capstone keeps its December dates. Recall dates follow the usual rule (forum or pass date + 2 / 7 / 30 days), so nothing is due straight after a pass. Baseline v2 demo: see `specs/22` §5 (all three parts open, `DEMO-L` has done them and `results_open` is on; `DEMO-M` rates `DEMO-L` and `DEMO-N`). The retake wait is 1 minute instead of 24 h; "Reset demo" in the footer clears the state (stored state from an older seed version is replaced automatically).
