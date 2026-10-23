# The 1% Planner · Hub

**Hub:** https://quanpro.github.io/CBP27/ (demo mode until the backend URL is set in `docs/config.js`)

The learning hub for **The 1% Planner 2027**, the capability program of Marico South East Asia's Planning & Customer Service team (Vietnam). Tagline: *Better every week.*

This repository holds:

| Folder | What it is |
|---|---|
| `program/` | The 2027 program in plain language: overview, catalogue, calendar, omnichannel model, IDP, measurement, Blink upload guide. No business figures or budget (those stay in the private plan of record). |
| `courses/` | One page per course (10 for 2027): objectives, episodes, predict and checkpoint blueprint, forum design, field assignment, KPI, build status. |
| `specs/` | Build specifications for the Hub web app and its private backend. Written for Claude Code. `19_build_decisions.md` and `20_api_contract.md` record the decisions taken at build time. |
| `tools/` | `check_no_private.mjs` privacy guard (pre-commit + CI). |
| `templates/` | IDP, forum kit, field sign-off rubric, capstone rubric, course build template. |
| `docs/` | The Hub web app served by GitHub Pages (built from `specs/`). |
| `backend/` | Google Apps Script backend (built from `specs/`). Deployed to Google, not served from here. |
| `reference/` | A working UI prototype from the earlier Claude-hosted diagnostic, to reuse patterns. |
| `content-private/` | **Never committed.** Item banks with answer keys, the full plan of record and the cost sheet. Delivered separately; items are imported into the private Google Sheet. |

## How the pieces fit

```
Learner (phone/laptop)
   │
   ├── Blink (company platform) ── videos only: 6–9 episodes per course
   │
   └── The 1% Planner Hub  (this repo → GitHub Pages, quanpro.github.io/CBP27, no company data)
          │   login: employee code + PIN
          ▼
       Google Apps Script web app (owned by the Planning Director)
          │   grading, retake rules, privacy
          ▼
       Private Google Sheet (shared only with the Planning Director and HR L&D)
          Items · Roster · Attempts · SelfRatings · Capstone · PanelScores · Summary
```

## Rules that never bend

1. No company data, names, scores or answer keys in this repository. It is public.
2. `content-private/` stays out of git (see `.gitignore`).
3. Individual results are visible only to the person, the Planning Director and HR L&D. Team views show averages only, with at least 3 people per group, and managers excluded.
4. The page never receives an answer key. Grading happens on the server.

## Start here

- Program owners: read `program/00_overview.md`.
- Builders (Claude Code): read `CLAUDE.md`, then `specs/17_build_plan.md`.
