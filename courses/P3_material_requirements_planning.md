# P3 · Material Requirements Planning

_Feed the line without feeding the warehouse._ · Vietnamese name: Hoạch định nhu cầu vật tư (MRP)

| | |
|---|---|
| Priority | 3 · Core planning |
| Cycle and dates | Cycle 5 · online 28 Jun–16 Jul 2027 · checkpoint closes Fri 23 Jul · forum Tue 27 Jul (with P2) · field until 10 Sep |
| Status | 🛠 To build · 7 episodes · ready by 1 Jun 2027 |
| Used at (S&OP step) | Weekly MRP run and purchasing; RPM phase-in/phase-out; step 15a inventory health. |
| Faculty | Quân facilitates; procurement joins for the supplier segment. |

## The business problem
Lines stop for missing materials while other materials pile up; MRP master data (lead times, MOQ, rounding, safety stock) is not trusted, and phase-outs leave stock behind.

## After this course you can
1. Net gross requirements: net = gross + safety stock − on hand − firm receipts  
   _Tính nhu cầu ròng: ròng = gộp + tồn kho an toàn − tồn hiện có − hàng chắc chắn về_
2. Apply MOQ and rounding to a planned order; set reorder points  
   _Áp dụng MOQ và làm tròn cho đơn đặt hàng dự kiến; xác định điểm đặt hàng lại_
3. Choose safety stock or safety time from demand vs supply variability  
   _Chọn tồn kho an toàn hay thời gian an toàn dựa trên biến động cầu và cung_
4. Read MRP exception messages and act on them  
   _Đọc các thông báo ngoại lệ của MRP và xử lý_
5. Manage RPM phase-in and phase-out with a stock overview, including supplier feedstock  
   _Quản lý chuyển đổi vật tư (RPM) bằng bảng tổng quan tồn kho, gồm cả nguyên liệu tại nhà cung cấp_

Self-rating statement (baseline Part A): "I net requirements, set lot sizes and safety buffers, and manage material changes so the line never stops and nothing becomes obsolete."

## Episodes on Blink (English voice, Vietnamese subtitles, 4–7 min each)
Every episode follows the house format from A1/C1: cold open with a hook → 8-second commit → title sting → three chapters with one 20-second pause-and-try → lightning round (3 checks) → takeaway with a cliffhanger. Cast: Linh (junior planner who makes the mistakes), Anh Minh (manager), the coach (narrator). Illustrative Marico-style numbers only; no other companies' names or data.

| Ep | Title | Hook and key ideas | Pause-and-try |
|---|---|---|---|
| 01 | The Line Stopped for a Cap | Cold open: a line stops for a cap that was 'in the system'. BOM explosion and lead-time offset. | When should we have ordered? |
| 02 | Net It Out | Gross to net: safety stock, on hand, firm receipts. | Calculate the net requirement. |
| 03 | The Order You Actually Place | MOQ and rounding; reorder points. | What quantity goes on the PO? |
| 04 | Buffers: Stock or Time? | Safety stock vs safety time; what drives buffer size. | Pick the buffer. |
| 05 | Reading the Exception List | Reschedule in/out, past due, inside lead time. | What does this message ask you to do? |
| 06 | Master Data Is the Plan | Wrong lead time or MOQ = wrong plan; the health check. | Find the data error. |
| 07 | Phase-in, Phase-out | Stock overview incl. supplier feedstock; last lot; link to P5. | How many labels go to waste? |

## On the Hub
- **Predict** (ungraded, before the videos): 3 questions — `content-private/md/P3_item_bank.md`.
- **Checkpoint** (gate to the forum): two parallel forms of 10; pass 8/10; retake with the other form after 24 h; third try after a 15-minute chat with the manager.
- **Spaced recall**: 3 questions on day 2, 7 and 30 after the forum, from the form not taken.
- **Baseline** carries 5 questions for this course (Part B + mini case).

### Checkpoint blueprint (items per objective)
| Objective | | Form A | Form B |
|---|---|---|---|
| 1 | Net gross requirements: net = gross + safety stock − on hand − firm receipts | 1 | 1 |
| 2 | Apply MOQ and rounding to a planned order; set reorder points | 3 | 3 |
| 3 | Choose safety stock or safety time from demand vs supply variability | 2 | 2 |
| 4 | Read MRP exception messages and act on them | 2 | 2 |
| 5 | Manage RPM phase-in and phase-out with a stock overview, including supplier feedstock | 2 | 2 |

## Offline forum (4 h, Vietnamese, Quân)
Shared with P2 (plan the line, feed the line): teams turn the MPS into purchase orders, find the exceptions and avoid both a line stop and an obsolete label.

Run-sheet: `templates/forum_kit_template.md`.

## Field assignment (live work, ~3 h)
Master-data health check for your top 20 RPMs (lead time, MOQ, rounding, safety stock); one phase-out stock overview.

Evidence for sign-off: Health-check sheet with fixes made, stock overview; manager sign-off. Rubric: `templates/field_signoff_rubric.md`.

## KPI it moves
Line stops for materials (target 0); RPM cover days; MRP exception count.

## Assets
To build: 7 episodes, RPM master-data checklist, stock-overview template.
