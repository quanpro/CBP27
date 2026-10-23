# 12 · Backend API (Apps Script web app)

Single endpoint: `POST GAS_URL`, body = JSON string, `Content-Type: text/plain;charset=utf-8`. Every response: `{"ok": true, ...}` or `{"ok": false, "error": {"code": "...", "message": "..."}}`. Error codes: `bad_request, auth_failed, locked, session_expired, not_open, gate_closed, retake_too_soon, unlock_needed, already_submitted, not_found, forbidden, server_error`.

Files: `backend/Code.gs` (doPost router), `backend/Auth.gs`, `backend/Assess.gs`, `backend/Logic.gs` (pure functions, Node-testable), `backend/Admin.gs` (menu), `backend/Setup.gs`, `backend/appsscript.json` (timeZone `Asia/Ho_Chi_Minh`, runtime V8, webapp access ANYONE_ANONYMOUS, executeAs USER_DEPLOYING). Wrap every write in `LockService.getScriptLock()` (tryLock 10 s).

## Actions

### `login` {code, pin}
- Check Roster row active, not locked; compare hash. On 5th failure set `locked_until = now + 15 min`.
- Returns `{token, profile: {code, first_name, role_area, is_manager, roles, lang, must_change_pin}}`. `first_name` = first word of display_name; only ever returned to that person.

### `change_pin` {token, old_pin, new_pin}
- 6 digits, not all the same digit, not 123456. New salt + hash.

### `me` {token}
- Returns the learner's journey: for each course in calendar order `{code, name_en, name_vi, open, blink_url, online_from, checkpoint_close, forum_date, field_until, predict_done, checkpoint: {best_pct, passed, attempts, next_retake_at, needs_unlock}, recall_due: [..]}` plus `baseline: {status, submitted_at}` and `capstone: {team_id?}`.
- Never returns other people's data.

### `start` {token, assessment, course?}
- `baseline`: allowed only inside the Config window, once per wave (resume if an open attempt exists). Serves Part A (10 self-rating statements from Courses, scale from `meta.scale`), Part B (40 items, order: by course in calendar order, shuffled within course), Part C (CASE1 context + 6 items). Time limit 60 min (client timer; server accepts submissions up to 70 min after start).
- `predict`: course open; serves the 3 PR items; unlimited attempts; ungraded.
- `checkpoint`: course open. Form rule in `14_assessment_rules.md` (first attempt form A for odd-numbered roster rows and B for even, alternating thereafter); `retake_too_soon` if last submitted < 24 h ago; `unlock_needed` for attempt ≥ 3 without an Unlocks row. Serves 10 items in shuffled order.
- `recall`: serves 3 items for a due Recall row (from the form not taken; if both taken, the form with fewer correct answers).
- Each served item: `{item_id, case_id, stem_en, stem_vi, options: [{id, en, vi}] in shuffled order}`. **Never include `answer` or `why`.** Option ids stay the original letters so grading needs no mapping.
- Writes an Attempts row (`status=open`). Returns `{attempt_id, items, case?, self?, scale?, time_limit_min?}`.

### `save` {token, attempt_id, answers, self_ratings?}
- Only the owner, only while `status=open`. Overwrites `answers` and `last_saved_at`.

### `submit` {token, attempt_id, answers, self_ratings?}
- Grades every served item (unanswered = wrong). Computes `score_pct`, `by_objective`, and for baseline `by_course` (Part B + case items mapped to their course).
- Checkpoint: `passed = score_pct ≥ pass_mark`. On first pass, schedules Recall rows for day 2, 7, 30 after the course's forum date.
- Returns:
  - baseline: `{score_pct, by_course, self_vs_score}` — no item-level feedback (keeps the re-test valid).
  - checkpoint: `{score_pct, passed, by_objective, missed: [{item_id, stem, your_option, correct_option, why}], next_retake_at}`. Showing the key for this form is fine: a retake uses the other form.
  - predict and recall: `{score_pct, review: [{item_id, correct_option, why}]}`.

### `team_status` {token} (managers only)
- For each direct report (Roster.manager_code = caller): per course `passed | not yet | not started`, field sign-off date if recorded. No scores.

### `team_summary` {token, scope: "baseline"|"course", course?}
- Reads Summary; returns groups with n ≥ team_view_min_n only; managers excluded from every group; `all` always shown if n ≥ 3.

### `capstone_submit` {token, stage, team_id, fields...}
- Any member of the team (members list) may submit or update until the stage deadline.

### `panel_list` / `panel_score` {token, stage, team_id, scores, comment} (role `panel` or `admin`)
- Judges see team submissions for the stage and post 1–5 scores on five criteria (`templates/capstone_rubric.md`).

## Pure functions in Logic.gs (unit-tested in Node)
`hashPin(salt, pin)` (inject digest fn) · `pickForm(rosterIndex, previousForms)` · `canRetake(lastSubmittedAt, now, retakeHours, attemptNo, maxFree, hasUnlock)` · `shuffle(array, seed)` · `serveItem(itemRow)` (strips answer/why) · `grade(servedIds, answers, keyMap, objectiveMap)` · `byCourse(...)` · `recallDates(forumDate, days)` · `summarise(rows, minN)` (excludes managers, suppresses n < 3).
