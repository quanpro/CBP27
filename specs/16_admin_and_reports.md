# 16 · Admin and reports (inside the private Sheet)

No admin web page. Quân and HR L&D work in the Sheet with a custom menu (`onOpen` in `backend/Admin.gs`): **1% Planner ▸**

| Menu item | What it does |
|---|---|
| Set up / repair tabs | `setupSheet()` |
| Import items from CSV | Reads a pasted `Items.csv`/`Courses.csv` into the tabs; validates 4 options + answer per item, objective ranges, no duplicate ids; reports problems in a dialog |
| Issue PINs for new roster rows | Generates 6-digit PINs for rows without a hash, shows them once in a dialog for HR to hand out privately, stores only hashes |
| Reset a PIN | Prompt for employee code; new PIN shown once; `must_change_pin = TRUE` |
| Unlock a retake | Prompt for code + course + reason → Unlocks row |
| Rebuild summaries | `buildSummary()` → Summary tab (team view rules: n ≥ 3, managers excluded) |
| Baseline heatmap | Builds/refreshes tab `Dash_Baseline`: rows = people (code + name, admin only), columns = 10 courses (score %) + self-rating, conditional colours, calibration flags |
| Course gate report | `Dash_Gate`: per course, who has passed / not yet / not started, first-try pass rate, most-missed items (top 3) for the forum's misconception slot |
| IDP export | `Dash_IDP`: per person, two largest gaps, suggested capability goals, current checkpoint status → copy into the HR system |
| Recall due list | Who has recall due this week (for the Monday huddle reminder) |

## The forum's 15-minute "most-missed ideas" slot
From `Dash_Gate`: the three items with the lowest correct rate for that course; Quân shows the idea (not the item) and the common wrong answer.

## Monthly program check (Quân + HR, 30 min)
Completion and pass rates by course, recall completion, field sign-offs, forum pulse, any locks or unlock requests. Quarterly: the one-page council view for VPSC (team-level only).
