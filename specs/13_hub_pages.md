# 13 · Hub pages (docs/)

Static, phone-first, EN/VI. One shared stylesheet `docs/css/hub.css`, one API client `docs/js/api.js`, one i18n helper `docs/js/i18n.js`, one quiz runner `docs/js/quiz.js`. Every page: header (Marico logo `docs/assets/marico-logo.png`, "The 1% Planner", tagline "Better every week" / "Mỗi tuần tốt hơn một chút", EN|VI toggle), main, footer (privacy line + link to `about.html`).

## Design tokens (copy into `:root`; redefine for dark mode under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`)
```
--bg:#F4F6F8; --paper:#FFFFFF; --ink:#051C2C; --text:#1E2B36; --muted:#5E6A75; --line:#D9E0E6;
--blue:#014FA1; --blue-soft:#E6EEF7; --green:#96C61C; --green-ink:#4E6B00; --warn:#B45309; --bad:#B42318;
dark: --bg:#0B1620; --paper:#12202C; --ink:#EEF3F8; --text:#D5DEE6; --muted:#93A2B0; --line:#24384A;
      --blue:#5EA2EE; --blue-soft:#15304A; --green:#A8D63A; --green-ink:#C4E77A; --warn:#F2B35B; --bad:#F08A7E;
Fonts: "Source Sans 3" (body), "Source Serif 4" (headings) from Google Fonts.
```
Course family colours: A (Analytics & AI) blue `#014FA1` · C (Communication) teal `#0E7C86` · P (Planning core) navy `#0B2C45`; pass = green, not yet = amber, locked = muted.

## Pages
| File | Purpose | Key behaviour |
|---|---|---|
| `index.html` | Login + My journey | Login card (employee code, PIN). After login: greeting with first name; baseline card (status, CTA while window open); 10 course cards in calendar order with status chips (Locked · Watch on Blink · Predict · Checkpoint · Passed ✓ · Forum date · Field due); next offline session; recall due. Token in `sessionStorage` (try/catch). |
| `course.html?c=A2` | Course page | Tagline, objectives (EN/VI), "Watch on Blink" button (Courses.blink_url), Predict button, Checkpoint button with state (passed / retake at … / needs manager chat), forum date and field assignment summary, recall items due. |
| `quiz.html?type=predict|checkpoint|recall&c=A2` | Quiz runner | One question per screen on phones, list view on ≥ 900 px; progress bar; autosave; EN/VI toggle switches stem and options live; submit confirm; result screen per `14_assessment_rules.md`. |
| `baseline.html` | Baseline (60 min) | Intro (privacy, 3 parts, timing) → Part A self-rating (10 statements, 0–4 scale with descriptions) → Part B (40 items grouped by course) → Part C (case panel stays visible: sticky on desktop, collapsible on phones) → review → submit. Timer visible; at 60:00 auto-submit. Resume after reload. |
| `capstone.html` | Team submission (Pitch Day, capstone) | Form fields from Capstone tab; SOI fields with live counters (≤ 60 words each); KPI before/after; value in VND with basis; evidence link. |
| `panel.html` | Judges | List of teams for the stage; rubric with 5 criteria × 1–5 and anchors; comment; saved per judge. |
| `team.html` | Team picture | Heatmap of averages by course × role group (n ≥ 3; managers excluded) from `team_summary`; managers additionally see `team_status` for their reports (passed / not yet, no scores). |
| `about.html` | Privacy and how it works | Who sees what; why there are no leaderboards; how to reset a PIN (ask HR). |

## Copy rules
- Plain, warm, short. English first; Vietnamese is a full translation, not a summary.
- Never show another person's name or score.
- Result screens lead with what to do next ("Passed: see you at the forum on Tue 26 Jan" / "Not yet: retake from 09:30 tomorrow with the other form; review the three ideas below").

## Accessibility
- Inputs labelled; radio groups as `fieldset` + `legend`; focus visible; colour never the only signal (icons + text); tap targets ≥ 44 px; works at 360 px with no horizontal scroll.

## Reference
`reference/diagnostic_prototype.html` is the earlier Claude-hosted baseline: reuse its layout, scale buttons, heatmap and EN/VI patterns, but replace its `window.claude` data calls with `docs/js/api.js`.
