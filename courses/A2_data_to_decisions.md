# A2 · Data to Decisions

_From a raw SAP extract to a report that refreshes itself._ · Vietnamese name: Từ dữ liệu đến quyết định

| | |
|---|---|
| Priority | 1 · AI enabling & data literacy |
| Cycle and dates | Cycle 1 · online 4–22 Jan 2027 · checkpoint closes Fri 22 Jan · forum Tue 26 Jan (Kick-off + Data & AI Lab, with A3) · field until 26 Feb |
| Status | 🛠 To build · 8 episodes · ready by 15 Dec 2026 |
| Used at (S&OP step) | Weekly reports; S&OE and DSR packs (every gate that uses a report). |
| Faculty | Quân facilitates; the four AI-ready planners help tables during the lab. |

## The business problem
Planners spend hours each week copying SAP extracts into Excel by hand; reports break, versions multiply and numbers disagree in S&OP meetings.

## After this course you can
1. Shape data as a clean table: one row per record, one column per field, no merged cells or subtotals  
   _Tổ chức dữ liệu thành bảng sạch: mỗi dòng một bản ghi, mỗi cột một trường, không gộp ô, không dòng tổng phụ_
2. Look up and summarise with XLOOKUP, SUMIFS/COUNTIFS and a PivotTable  
   _Tra cứu và tổng hợp bằng XLOOKUP, SUMIFS/COUNTIFS và PivotTable_
3. Build a Power Query that imports, cleans, merges or appends, unpivots and refreshes  
   _Xây Power Query để nhập, làm sạch, ghép (merge/append), unpivot và làm mới dữ liệu_
4. Choose the chart that answers the question and avoid misleading axes  
   _Chọn biểu đồ trả lời đúng câu hỏi và tránh trục gây hiểu nhầm_
5. Read a Power BI page: slicers, filters and measures  
   _Đọc một trang Power BI: slicer, bộ lọc và measure_

Self-rating statement (baseline Part A): "I turn raw SAP or Excel extracts into clean tables and reports that refresh themselves (Power Query, PivotTable, Power BI)."

## Episodes on Blink (English voice, Vietnamese subtitles, 4–7 min each)
Every episode follows the house format from A1/C1: cold open with a hook → 8-second commit → title sting → three chapters with one 20-second pause-and-try → lightning round (3 checks) → takeaway with a cliffhanger. Cast: Linh (junior planner who makes the mistakes), Anh Minh (manager), the coach (narrator). Illustrative Marico-style numbers only; no other companies' names or data.

| Ep | Title | Hook and key ideas | Pause-and-try |
|---|---|---|---|
| 01 | The Monday Copy-Paste | Cold open: Linh's Monday starts at 7:30 with the same SAP extract and 12 manual steps; at 10:15 Anh Minh asks for the number. Misconception: 'Excel skill = more formulas'. Idea: the clean-table rule. | Spot three rule-breakers in a real-looking extract. |
| 02 | One Row, One Truth | Data types, dates stored as text, merged headers, totals inside data; why Power BI and PivotTables need tidy data. | Fix a table in four moves. |
| 03 | Find It Fast | XLOOKUP, SUMIFS, COUNTIFS; the #N/A trailing-space trap; lookup keys. | Which formula answers which question? |
| 04 | The Pivot That Answers | PivotTables for share, mix and trend; percent vs percentage points; error % of actual. | Is 60% → 66% a 6% or a 10% rise? |
| 05 | Record Once, Refresh Forever | Power Query: import, clean, refresh; the applied-steps list as a recipe. | Order the steps of a weekly clean-up. |
| 06 | Stack, Join, Unpivot | Append vs Merge vs Unpivot with SKU, customer and week data. | Pick the operation for three data puzzles. |
| 07 | Charts That Tell the Truth | Chart choice by comparison type; truncated axes; one message per chart (link to C1). | Redraw a misleading bar chart. |
| 08 | Your First Power BI Page | Slicers, filters, one measure, one page for S&OE; refresh from the Power Query. | What happens when you click this slicer? |

## On the Hub
- **Predict** (ungraded, before the videos): 3 questions — `content-private/md/A2_item_bank.md`.
- **Checkpoint** (gate to the forum): two parallel forms of 10; pass 8/10; retake with the other form after 24 h; third try after a 15-minute chat with the manager.
- **Spaced recall**: 3 questions on day 2, 7 and 30 after the forum, from the form not taken.
- **Baseline** carries 4 questions for this course (Part B).

### Checkpoint blueprint (items per objective)
| Objective | | Form A | Form B |
|---|---|---|---|
| 1 | Shape data as a clean table: one row per record, one column per field, no merged cells or subtotals | 2 | 2 |
| 2 | Look up and summarise with XLOOKUP, SUMIFS/COUNTIFS and a PivotTable | 3 | 3 |
| 3 | Build a Power Query that imports, cleans, merges or appends, unpivots and refreshes | 3 | 3 |
| 4 | Choose the chart that answers the question and avoid misleading axes | 1 | 1 |
| 5 | Read a Power BI page: slicers, filters and measures | 1 | 1 |

## Offline forum (4 h, Vietnamese, Quân)
Data & AI Lab (with A3). Teams rebuild the same messy weekly report from a raw extract with Power Query; race to a 5-minute refresh; then Copilot drafts the commentary and the team fact-checks it. Show-and-tell slot opens the program (kick-off).

Run-sheet: `templates/forum_kit_template.md`.

## Field assignment (live work, ~3 h)
Rebuild one weekly report you own in Power Query; prove it refreshes in under 5 minutes; log hours saved.

Evidence for sign-off: Before/after screenshots, refresh time, hours saved a week, manager sign-off with the rubric. Rubric: `templates/field_signoff_rubric.md`.

## KPI it moves
Hours saved per week (team target ≥ 10 h/week by Dec 2027); report refresh errors.

## Assets
To build: 8 episodes (v4 motion style, EN voice + VI subtitles), lab data pack (anonymised extract), job card 'Clean table rules'.
