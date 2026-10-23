# P4 · Demand & the Business

_The forecast is a business plan in units._ · Vietnamese name: Nhu cầu và hiệu quả kinh doanh

| | |
|---|---|
| Priority | 3 · Core planning (demand foundations through business acumen) |
| Cycle and dates | Cycle 6 · online 16 Aug–17 Sep 2027 · checkpoint closes Fri 24 Sep · forum Tue 28 Sep · field until 22 Oct |
| Status | 🛠 To build · 8 episodes · ready by 1 Aug 2027 |
| Used at (S&OP step) | G1 MAM, G2 Driver Lock, G3 ML Review, G5 Demand Review; step 11 FVA attribution; step 16 volume-to-value reconciliation. |
| Faculty | Quân facilitates; Finance guest for volume-to-value; regional data science team for the ML segment. |

## The business problem
Forecasts are judged in cases, not in money; drivers are not logged; bias persists; overrides to the ML forecast are frequent, small and unmeasured.

## After this course you can
1. Turn volume into value (NSV, gross margin, trade spend) and trace a forecast miss to P&L, cash and service  
   _Quy đổi sản lượng ra giá trị (doanh thu thuần, lãi gộp, chi phí thương mại) và truy tác động của sai số dự báo lên P&L, dòng tiền và dịch vụ_
2. Name the drivers of our demand and keep a driver log  
   _Gọi tên các yếu tố tác động đến nhu cầu và duy trì nhật ký yếu tố_
3. Measure accuracy and bias: lag-1 wMAPE, bias, tracking signal  
   _Đo độ chính xác và độ lệch: wMAPE lag-1, độ lệch, tracking signal_
4. Read what the ML forecast can and cannot see  
   _Hiểu dự báo ML thấy được gì và không thấy gì_
5. Apply FVA and the five override rules  
   _Áp dụng FVA và năm nguyên tắc điều chỉnh_

Self-rating statement (baseline Part A): "I explain what our forecast means in money, find the drivers behind bias, and only override the ML forecast with logged evidence."

## Episodes on Blink (English voice, Vietnamese subtitles, 4–7 min each)
Every episode follows the house format from A1/C1: cold open with a hook → 8-second commit → title sting → three chapters with one 20-second pause-and-try → lightning round (3 checks) → takeaway with a cliffhanger. Cast: Linh (junior planner who makes the mistakes), Anh Minh (manager), the coach (narrator). Illustrative Marico-style numbers only; no other companies' names or data.

| Ep | Title | Hook and key ideas | Pause-and-try |
|---|---|---|---|
| 01 | A Forecast Is a Promise in Money | Cold open: 5,000 cases short is 800M VND of margin. Why demand planners must speak P&L. | What is this miss worth? |
| 02 | From Volume to Value | NSV, gross margin, trade spend; how a miss hits P&L, cash and service. | Volume to value in two steps. |
| 03 | What Moves Our Demand | Price, promotion, distribution, seasonality and Tết, channels, launches; the driver log. | Which driver explains this spike? |
| 04 | Accurate or Just Lucky? | Lag-1 wMAPE, bias, tracking signal; aggregation. | Bias or noise? |
| 05 | Inside the Machine | What the ML forecast sees and cannot see; feeding it drivers. | Can the model see this? |
| 06 | Five Rules for Touching the Forecast | FVA; no small tweaks, careful going up, one owner, reason first, review without blame. | Which override is allowed? |
| 07 | Tết, Launches and Other Shocks | Events and new portfolio (including Candid); moving peaks. | Move the peak. |
| 08 | The Demand Review That Decides | Consensus in money; the forecast story told answer-first. | Write the Demand Review headline. |

## On the Hub
- **Predict** (ungraded, before the videos): 3 questions — `content-private/md/P4_item_bank.md`.
- **Checkpoint** (gate to the forum): two parallel forms of 10; pass 8/10; retake with the other form after 24 h; third try after a 15-minute chat with the manager.
- **Spaced recall**: 3 questions on day 2, 7 and 30 after the forum, from the form not taken.
- **Baseline** carries 5 questions for this course (Part B + mini case).

### Checkpoint blueprint (items per objective)
| Objective | | Form A | Form B |
|---|---|---|---|
| 1 | Turn volume into value (NSV, gross margin, trade spend) and trace a forecast miss to P&L, cash and service | 3 | 2 |
| 2 | Name the drivers of our demand and keep a driver log | 2 | 2 |
| 3 | Measure accuracy and bias: lag-1 wMAPE, bias, tracking signal | 2 | 2 |
| 4 | Read what the ML forecast can and cannot see | 1 | 2 |
| 5 | Apply FVA and the five override rules | 2 | 2 |

## Offline forum (4 h, Vietnamese, Quân)
Demand & the Business: teams take one category's forecast, rebuild it as a business plan in VND, find the bias drivers, decide which overrides survive the five rules, and present the Demand Review headline answer-first.

Run-sheet: `templates/forum_kit_template.md`.

## Field assignment (live work, ~3 h)
Bias root cause on your top 10 SKUs with a driver log; one full cycle of override log with FVA.

Evidence for sign-off: Driver log, override log with FVA, bias chart; manager sign-off. Rubric: `templates/field_signoff_rubric.md`.

## KPI it moves
Bias; lag-1 wMAPE; FVA ≥ 0; ≥ 80% of overrides logged with a reason.

## Assets
To build: 8 episodes, override log and FVA template (from the toolkit), category data pack.
