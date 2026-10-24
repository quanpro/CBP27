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

### `login` `{code, pin}` → `{token, expires_at, profile: Profile}`
Code is trimmed and upper-cased. Errors: `auth_failed` (unknown code, inactive, wrong PIN), `locked {until}`.

### `change_pin` `{token, old_pin, new_pin}` → `{token, expires_at, profile}`
New PIN: 6 digits, not all the same digit, not `123456`/`654321`, not equal to the old PIN. Bumps `session_ver` (other devices log out) and clears `must_change_pin`. Errors: `auth_failed` (old PIN wrong), `pin_weak`.

### `consent` `{token}` → `{consent_at}`  ·  `set_lang` `{token, lang}` → `{lang}`  ·  `logout` `{token}` → `{}`
`logout` bumps `session_ver`: the token (and any other device's) stops working. Until `consent` is called, every action except login, change_pin, me, consent, set_lang and logout returns `consent_required`.

### `me` `{token}` → journey
```
{
  profile: Profile,
  baseline: {
    wave, open_from, open_to, window: "before"|"open"|"after",
    status: "not_started"|"in_progress"|"submitted",
    attempt_id?, started_at?, deadline_at?, submitted_at?,
    result?: { score_pct, by_course: {A2: 55, …}, self: {A2: 2, …}, gaps: ["P3","A2"] },
    previous?: { wave, score_pct, by_course }          // earlier wave, for re-test comparison
  },
  courses: [ {                                         // calendar order
    code, order, cycle, open, online_from, checkpoint_close, forum_date, field_until, late_until,
    blink_url,                                         // course playlist link (may be "")
    episodes: [ { ep, minutes, blink_url, embed_url, watched } ],   // ep 0 = trailer
    predict:    { done, attempts, last_pct },
    checkpoint: { status: "not_started"|"in_progress"|"not_yet"|"passed",   // reveal of correct answers: only once passed (D5)
                  attempts, best_pct, passed_at, next_retake_at, needs_unlock, gate_closed,
                  open_attempt_id, last_attempt_id },
    recall: [ { day: 2|7|30, due_date, status: "upcoming"|"due"|"done", score_pct, attempt_id } ]
  } ],
  capstone: { team_id, project_title, pitch_submitted_at, capstone_submitted_at, pitch_deadline, capstone_deadline },
  streak:   { current_weeks, active_this_week, active_weeks_total, multiplier, weeks_total_program: 52, recent: [bool×12] },
            // multiplier = 1.01^active_weeks_total (2 dp); recent = last 12 weeks, oldest first; Config streak_skip_weeks (e.g. Tết) neither break nor add
  certificates: { level: Profile.certificate, checkpoints_passed, checkpoints_total: 10, pitch_submitted, capstone_submitted }
}
```
`open` = the Courses `open` flag is TRUE and today ≥ `online_from`. `late_until` = `forum_date + late_days`.

### `watch` `{token, course, ep, watched: true|false}` → `{course, watched: [ep, …]}`

### `start` `{token, assessment, course?, day?}`
`assessment`: `baseline` | `predict` | `checkpoint` | `recall` (recall needs `course` and `day`). Resumes the open attempt if one exists (`resumed: true`, saved `answers` and `self_ratings` returned).
```
{ attempt_id, assessment, course, form, attempt_no, started_at, resumed, deadline_at?, time_limit_min?,
  answers: {item_id: option_id}, self_ratings?: {A2: 0..4},
  items: [Item],
  self?:  [ {course, en, vi} ],                          // baseline Part A, calendar order
  scale?: [ {level, en, vi, desc_en, desc_vi} ],         // baseline Part A
  case?:  { case_id, title_en, title_vi, context_en, context_vi },   // baseline Part C
  parts?: { A: 10, B: 40, C: 6 } }                       // baseline only; items = Part B (by course, calendar order) then Part C
```
Rules (spec 14 + decisions):
- baseline: window open (or an open attempt exists), once per wave; 60 min + 10 min grace.
- predict: course open; unlimited; 3 items.
- checkpoint: course open → `not_open`; already passed → `already_passed`; last submit < 24 h → `retake_too_soon`; attempt ≥ 3 without an unused Unlocks row → `unlock_needed`; after `late_until` without an unused unlock → `gate_closed`. 10 items.
- recall: a Recall row for that course and day with `due_date ≤ today` and status `due` → else `not_due`. 3 items.

### `save` `{token, attempt_id, answers, self_ratings?}` → `{saved_at}`
Owner only, attempt open. Errors: `already_submitted`, `not_found`.

### `submit` `{token, attempt_id, answers, self_ratings?}` → result
Unanswered = wrong. Idempotent: submitting an already-submitted attempt returns the stored result.
```
baseline:   { assessment, score_pct, by_course: {A2: …}, self: {A2: …}, gaps: [code, code] }       // no item feedback
checkpoint: { assessment, course, form, attempt_no, n_items, n_correct, score_pct, passed, reveal,
              by_objective: { "1": {n, correct}, … }, weak_objectives: [3, 5],
              missed: [ReviewRow], next_retake_at, needs_unlock, forum_date, recall_dates?: [date×3] }
predict:    { assessment, course, n_items, n_correct, score_pct, review: [ReviewRow] }            // reveal always
recall:     { assessment, course, day, n_items, n_correct, score_pct, review: [ReviewRow] }       // reveal always
```
`gaps` = the two lowest course scores; tie → lower self-rating first, then calendar order. Baseline self-ratings: all 10 required (`bad_request` otherwise), except on a server-side expiry.

### `review` `{token, attempt_id}` → the same result shape as `submit`, recomputed now (so `reveal` can turn true later). Own submitted attempts only.

### `team_summary` `{token}` → averages (any signed-in user)
```
{ updated_at, min_n, wave, baseline_published, baseline_publish_after,
  baseline:    [ { group: "all"|"demand"|"supply"|"materials"|"cs", n, courses: { A2: {self: 1.8, pct: 52}, … } } ],
  checkpoints: [ { group, n, courses: { A2: {first_try_pass: 60, passed_by_forum: 90}, … } } ] }
```
Groups with n < `min_n` are left out; a metric counted for fewer than `min_n` people is `null`; managers and test users are never counted. Baseline groups stay empty until the window has closed (`baseline_published`); a course's checkpoint metrics stay `null` until its late window has closed (decision F21).

### `team_status` `{token}` → manager only (`forbidden` otherwise)
`{ reports: [ { code, first_name, baseline: "done"|"not_done", courses: { A2: "passed"|"needs_chat"|"not_yet"|"not_started", … } } ] }` — no scores; reports who are managers are not listed. `needs_chat` = not passed, no open attempt, and the free attempts are used up (or the late window has closed) with no unused unlock.

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

## Demo mode (`docs/js/mock-api.js`)
Same actions and shapes, state in `localStorage` (`hub.mock.v1`). Invented items only (`MOCK-…` ids, a `mockCorrect` field that is stripped before items reach page code). Demo accounts: `DEMO-L` (learner), `DEMO-M` (manager + panel), `DEMO-N` (first login, must change PIN), all with PIN `270127`. All courses are open; the retake wait is 1 minute instead of 24 h; "Reset demo" in the footer clears the state.
