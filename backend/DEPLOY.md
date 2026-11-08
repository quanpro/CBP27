# Deploying the Hub backend (step by step, for Quân)

This puts the backend (grading, retake rules, privacy) into **your** Google account, next to a private Google Sheet. You need no Apps Script experience. Allow about 45 minutes the first time.

**What you need**
- Your Google account, with 2-step verification switched on.
- From this repository: `backend/dist/Hub.gs` and `backend/dist/appsscript.json` (open each on GitHub ▸ **Raw** ▸ select all ▸ copy).
- From your private folder (never from GitHub): `Items.csv`, `Courses.csv`, `Cases.csv`, and for the baseline the bank's `Items.csv` (→ **BaselineItems**) and `Exhibits.csv` (→ **Exhibits**) plus the **BaselineText** rows.

> Never upload the CSV files, PINs or anything from the Sheet to GitHub. The repository is public.

---

## 1 · Create the Sheet
> **Already done for the CBP27 build:** a private Sheet named **1pct-planner-data** is in Quân's Google Drive, with the **Items**, **Courses** and **Cases** tabs filled in. Open it and go straight to step 2. In step 6, skip the import of those three and just run **Validate items / courses**; the baseline tabs are loaded in step 6b.

1. Go to <https://sheets.new>. Name the file **1pct-planner-data** (top left).
2. Leave sharing as it is for now (private). Step 12 covers sharing.

## 2 · Open the script editor
1. In the Sheet: **Extensions ▸ Apps Script**. A new tab opens with a file called `Code.gs`.
2. Click "Untitled project" (top left) and rename it **1% Planner Hub backend**.

## 3 · Paste the code
1. In `Code.gs`, select everything (Ctrl+A) and delete it.
2. Paste the whole content of `backend/dist/Hub.gs`. Press **Ctrl+S** to save. (You may rename the file to `Hub`; the name does not matter.)

## 4 · Paste the manifest (settings file)
1. Click the **gear icon (Project Settings)** on the left. Tick **Show "appsscript.json" manifest file in editor**.
2. Go back to the **Editor** (the `< >` icon). Open `appsscript.json`, select everything, and replace it with the content of `backend/dist/appsscript.json`. Save.
   This sets the time zone to Ho Chi Minh, the web-app access, and the only permissions the script asks for: this one spreadsheet, dialogs in the Sheet, and an hourly timer.

## 5 · Run `setupSheet` once (creates every tab)
1. In the toolbar, pick **setupSheet** in the function list, then press **Run**.
2. Google asks for permission: **Review permissions** ▸ choose your account ▸ "Google hasn't verified this app" ▸ **Advanced** ▸ **Go to 1% Planner Hub backend (unsafe)** ▸ **Allow**. The warning appears because this is your own script, not a published app.
3. The execution log lists what was created (tabs, Config defaults, course dates, episode rows, two secret keys).
4. Go back to the Sheet tab and **reload the page**. A menu **1% Planner** appears next to Help.

`setupSheet` is safe to run again at any time: it never deletes data. It also sets every cell to plain text so Google does not turn `2026-11` into a date or `00123` into `123`.

## 6 · Import the private item bank
If the three tabs are already filled in (see step 1), skip to the **Validate** paragraph below.

Do this for **Items**, **Courses** and **Cases**, one at a time:
1. Click the tab (for example **Items**).
2. **File ▸ Import ▸ Upload** ▸ choose `Items.csv`.
3. Import location: **Replace current sheet**. Separator: **Comma**. **Untick "Convert text to numbers, dates and formulas"**. Press **Import data**.

Then run **1% Planner ▸ Validate items / courses**. It puts back the plain-text format, refills the Courses calendar columns that the import removed (order, cycle, online_from, checkpoint_close, forum_date, field_until, open) and lists any problems. You want "✔ No problems". Warnings about counts mean a course has fewer or more items than the blueprint (3 predict, 10 per checkpoint form). Old `baseline` rows left in Items are ignored (one warning says how many).

Alternative: **1% Planner ▸ Import items from CSV…** lets you paste the CSV text instead (Courses rows are then updated by code and keep your dates and links).

## 6b · Load the Baseline v2 tabs (BaselineItems, Exhibits, BaselineText)
`setupSheet` (step 5, or **Set up / repair tabs** on an existing Sheet) creates the empty tabs **BaselineItems**, **Exhibits**, **BaselineText**, **Ratings**, **Overrides** and **Profiles**, adds the new columns to **Roster** (`p3_module`) and **Attempts**, and adds the new Config keys. It never deletes anything.
1. **Exhibits** first: click the tab ▸ **File ▸ Import ▸ Upload** ▸ the bank's `Exhibits.csv` ▸ **Replace current sheet**, Comma, **untick "Convert text to numbers, dates and formulas"** (exhibit lines that start with `-` must stay text).
2. **BaselineItems**: same steps with the bank's `Items.csv`. The column order does not matter (the Hub reads by header). The bank has no `allow_nr` column: run **Set up / repair tabs** once to add it back at the end, then type `TRUE` in `allow_nr` for the three "not my role" statements (rating statements R03, R10 and R13 of Part 2).
3. **BaselineText**: one row per key (`key`, `en`, `vi`): section titles and intros, case titles, the 1–4 scale labels, `p2_scale_na` (manager form), `p2_scale_nr` (self form), the charter names, the rater guide, the Part 3 glossary lines. The key list is in `specs/11_sheet_schema.md`.
4. **Validate items / courses** also checks the baseline: unique ids, each live Part 1 form has 32 items, every SJT has two different keys, every mcq key is a–d, every rating statement has self and manager wording, and every exhibit an item points to exists. You want "✔ No problems" (if you import BaselineItems before Exhibits, every exhibit is reported missing until Exhibits is in).
5. **Refresh cache**.

Instead of File ▸ Import you can paste the CSV text into **Import items from CSV…** and choose BaselineItems, Exhibits or BaselineText (the tab is replaced).

## 7 · Check Courses, Episodes and Config
- **Courses** (the course timeline lives here): `order` and `cycle` set the order on My learning; `online_from` / `online_to` the "On Blink" window; `checkpoint_close`, `forum_date` and `field_until` the other dates. The defaults come from the program calendar and only fill blank cells: change any date here, then **Refresh cache**. Paste each course's Blink playlist link into `blink_url` when HR has it. `open = TRUE` means the course opens by itself on `online_from`; set `FALSE` to hold a course back.
- **Sessions** (the offline sessions): one row per forum, Pitch Day and the War Room: `date`, `kind` (`kickoff`, `forum`, `pitch` or `warroom`), `courses` (codes, e.g. `C1 P1`), `title_en`, `title_vi`, `start`, `end` (e.g. `13:30`, `17:30`), `place`, optional `note_en` / `note_vi` (shown on the course page under the forum), `active`. The forum card of a course shows the session on its `forum_date`; its Teach stage is the first session after its field work. My path and the help page list them all. Keep each course's `forum_date` equal to the date of its session. Setup fills the tab once with the nine 2027 sessions; after that it never touches it.
- **Episodes**: one row per episode (ep 0 = trailer). Paste the Blink link into `blink_url`, and an embeddable player link into `embed_url` if Blink allows it (otherwise leave it empty: the Hub shows a "Watch on Blink" card). `minutes` is optional.
  - **YouTube instead of Blink:** paste the normal YouTube link (`https://youtu.be/…` or `https://www.youtube.com/watch?v=…`, as copied from **Share**) into `blink_url`; leave `embed_url` empty. The episode then plays inside the course page (YouTube's privacy-enhanced player, no YouTube cookies until the learner presses play). A `&t=75` or `?t=1m15s` start time is kept. In YouTube Studio set each video to **Unlisted** (Private videos cannot be embedded) and leave **Allow embedding** ticked (Details ▸ Show more ▸ License). When Blink is ready, replace the link; nothing else changes.
  - Try one episode on the office Wi-Fi and on a phone before the course opens: some company networks block YouTube.
- **Config** (one row per setting; edit the `value` column):

| key | default | meaning |
|---|---|---|
| wave | 2026-11 | baseline wave (re-test: 2027-12) |
| pass_mark | 0.8 | checkpoint pass mark (8 of 10) |
| retake_hours | 24 | wait between checkpoint attempts |
| max_free_attempts | 2 | the 3rd attempt needs an unlock |
| late_days | 7 | the checkpoint stays open until forum date + 7 days (later attempts need an unlock). The correct answers are shown only to people who have passed |
| team_view_min_n | 3 | smallest group shown in team views |
| session_hours | 6 | how long a login lasts |
| recall_days | 2,7,30 | recall days after the forum (or after a late pass) |
| pitch_deadline / capstone_deadline | 2027-06-21 / 2027-12-20 | last day to submit |
| lock_failures | 5 | wrong PINs before a lock: 15 min, then 30 min; the **3rd lock within 7 days stays until you clear it** (see step 9) |
| streak_skip_weeks | 2027-02-08 | Mondays of weeks (comma-separated) that neither break nor add to a learner's weekly streak, e.g. the Tết week; leave empty for none |
| p1_open / p2_open / p3_open | FALSE | baseline part open for everyone (use **Baseline: open or close parts…**) |
| rating_open | FALSE | managers and admins can rate their reports |
| results_open | FALSE | learners see their baseline profile; baseline team averages publish |
| p1_live / p1_backup | B,C / A | Part 1 forms; the backup only through **Assign a Part 1 form…** |
| p1_minutes / p2_minutes / p3_minutes | 65 / 35 / 48 | one timer per part (fixed when a person starts) |
| grace_minutes | 5 | server grace after each part's timer; after it the last save is graded |
| p2_w_sjt / p2_w_mgr | 0.5 / 0.5 | charter index = SJT weight × SJT % + manager weight × manager score |
| equate_threshold_pts | 5 | Part 1 scores are equated when the live forms' means differ by more than this |

The old keys `baseline_open_from`, `baseline_open_to`, `baseline_minutes` and `baseline_grace_minutes` are no longer used (you may delete those rows).

After editing Items, Courses, Episodes or Config, run **1% Planner ▸ Refresh cache** (otherwise the Hub picks the change up within 10 minutes).

## 8 · Add people
**Roster** tab, one row per person (paste values only: Ctrl+Shift+V):

| column | what to type |
|---|---|
| employee_code | HR code (3–20 letters, digits, `-` or `_`) |
| display_name | full name (only you, HR and the person see it) |
| preferred_name | optional: the name for the greeting (otherwise the last word of display_name) |
| role_area | `demand`, `supply`, `materials` or `cs` |
| is_manager | `TRUE` for the three managers, else `FALSE` |
| manager_code | the person's manager's code (also decides who rates whom in Baseline Part 2: put your own code as the manager_code of the three managers and of your direct reports) |
| p3_module | optional: `DP`, `SP`, `RPM` or `CS` for the Baseline Part 3 module (otherwise from role_area: demand → DP, supply → SP, materials → RPM, cs → CS; set it for anyone without a role_area) |
| roles | `learner`; managers `learner;manager`; judges `panel`; you and HR `admin`; add `test` for test accounts (left out of every summary) |
| active | `TRUE` (`FALSE` blocks the login) |
| lang | `en` or `vi` |

Leave every other column empty: the script fills them.
**Teams** tab (for Pitch Day and the capstone): `team_id`, `project_title`, `members` (codes separated by `;`), `sponsor_code`, `active` = `TRUE`.

## 9 · Issue PINs
**1% Planner ▸ Issue PINs for new roster rows**. A window shows each new code with a 6-digit PIN **once**. Copy them onto the PIN cards now; the Sheet keeps only a scrambled version (a salted hash), so nobody can read a PIN later. Everyone chooses their own PIN at first login, then accepts the privacy notice before anything else works. Lost PIN: **Reset a PIN…** (it also signs the person out everywhere and clears any lock).

**Locks.** 5 wrong PINs lock a code for 15 minutes; a second lock within 7 days lasts 30 minutes; the **third lock within 7 days stays until an admin lifts it**. If the person still knows their PIN, use **1% Planner ▸ Clear a lock…** (the PIN stays the same); if not, use **Reset a PIN…**. Codes that do not exist lock the same way, so nobody can find out which codes are real by guessing.

## 10 · Publish the web app
1. In the script editor: **Deploy ▸ New deployment**. Click the gear next to "Select type" ▸ **Web app**.
2. Description: `v1`. **Execute as: Me**. **Who has access: Anyone**. Press **Deploy** (authorise again if asked).
3. Copy the **Web app URL** (it ends in `/exec`).
4. In this repository, edit `docs/config.js` (on GitHub: open the file ▸ pencil icon) so it reads
   ```js
   export const GAS_URL = "https://script.google.com/macros/s/…/exec";
   ```
   and commit. The URL is not a secret: it is useless without a code and PIN.

"Anyone" is correct: learners do not need a Google account. Security comes from the code + PIN, the signed session token and the script itself.

## 11 · Test it (specs/17 step 2)
Use three test rows in Roster (for example codes `TEST1`–`TEST3`, roles `learner;test`) and issue their PINs. Course A2 only opens on 4 Jan 2027, so for this test set A2's `online_from` to today and run **Refresh cache**.

1. Open the `/exec` URL in a browser: you should see `{"ok":true,"server_now":"…+07:00",…}`.
2. Open the Hub (or any web page), press F12 ▸ **Console**, and paste (replace the URL and the PIN):
   ```js
   const GAS = 'https://script.google.com/macros/s/…/exec';
   const call = (p) => fetch(GAS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) }).then((r) => r.json());
   let r = await call({ action: 'login', code: 'TEST1', pin: 'PIN-FROM-THE-DIALOG' });
   r = await call({ action: 'change_pin', token: r.token, old_pin: 'PIN-FROM-THE-DIALOG', new_pin: '135790' });
   const token = r.token;
   const s = await call({ action: 'start', token, assessment: 'checkpoint', course: 'A2' });
   console.log(s.items.length, /"answer"|why_|"correct"/.test(JSON.stringify(s)));   // expect: 10 false
   const answers = Object.fromEntries(s.items.map((i) => [i.item_id, 'a']));
   console.log(await call({ action: 'submit', token, attempt_id: s.attempt_id, answers }));   // score_pct, passed …
   ```
   From a terminal the same works with curl (`-L` follows Google's redirect):
   `curl -sL -H 'Content-Type: text/plain;charset=utf-8' -d '{"action":"login","code":"TEST1","pin":"…"}' 'https://script.google.com/macros/s/…/exec'`
3. In the Sheet: **Attempts** has the row (status `submitted`, score); **Log** shows login / change_pin / start / submit with no PIN and no answers.
4. Put A2's `online_from` back to `2027-01-04`, run **Refresh cache**, and void the test attempts (**Void an attempt…** with the `attempt_id` from column A of Attempts).

## 11b · Running the baseline (Baseline v2)
Everything is opened by hand, for everyone at once. No dates are involved.

**Open or close a part.** **1% Planner ▸ Baseline: open or close parts…** shows five switches with their current state: **Part 1**, **Part 2**, **Part 3**, **Manager rating**, **Results**. Tick or untick and press **Save** (it writes the Config rows and refreshes the cache at once). While a part is open, every active person can start it **once per wave**. Closing a part stops new starts; anyone already in a sitting can still finish until their own timer runs out (then the last save is graded automatically).

**Part 1 forms.** Forms B and C are served automatically, balanced within each role group; form A is the backup and is never served on its own. To give someone a specific form (the backup after a leak, a re-sit after a technical problem, a person who has seen a live form): **1% Planner ▸ Assign a Part 1 form…** (code, form, reason). It writes an **Overrides** row that applies at their next start. If they already have a Part 1 attempt, the dialog says so: **Void an attempt…** first, then they can sit again.

**Manager rating.** Turn on **Manager rating** after the parts (the statements describe what Part 2 rewards, and managers sit Part 2 too). Managers and admins then see **Rate my team** on the Hub: the rater guide, the 23 statements in manager wording, 1–4 or N/A. Each rater–person set can be edited while rating is open. Who rates whom comes from `Roster.manager_code`; test users and inactive people are not listed. Learners never see item-level manager ratings.

**Results.** **1% Planner ▸ Build baseline profiles** grades any expired sitting, equates Part 1 (when the live forms' means differ by more than `equate_threshold_pts`) and writes one **Profiles** row per person. Check the numbers in the reports below, then turn on **Results**: learners see their profile on the Hub and the team page shows the baseline averages (groups under 3, managers and test users left out). While Results is on, the hourly trigger (**Install hourly summary trigger**) rebuilds the profiles and the team numbers every hour. After a sitting a learner only sees "Part N done" and the time used: no score and no item feedback, so the Dec 2027 re-test stays valid.

**Reports (admin only, never on the Hub).** **1% Planner ▸ Baseline v2 reports** writes `Dash_BL2_Heatmap` (person × area), `Dash_BL2_Items` (p-value, point-biserial, distractor %, per item), `Dash_BL2_Forms` (starts and means per Part 1 form, and whether equating applied), `Dash_BL2_Raters` (mean and spread per rater, to spot leniency) and `Dash_BL2_Flags` (blind spot, hidden strength, knowing–doing gap, rates high / scores low). **IDP export** now uses the two baseline gaps.

## 12 · Sharing and safety (do not skip)
- Share the Sheet only with HR L&D (Editor). **Share ▸ General access: Restricted** (link sharing off). Nobody else, including managers.
- **Anyone who can edit the Sheet can open its script** (Extensions ▸ Apps Script): they can read the secret keys in Script Properties, change the code, and read every result. Give Editor access only to people you trust completely (today: HR L&D). Never add a Viewer or Editor "just to look"; send an export instead.
- 2-step verification on your account and HR's.
- **Project Settings ▸ Script Properties** holds `TOKEN_SECRET` and `PIN_PEPPER`. Never copy, share or delete them. If `PIN_PEPPER` is lost every PIN must be re-issued (clear `pin_hash` and run Issue PINs). Changing `TOKEN_SECRET` signs everyone out (harmless).
- Do not sort, delete or move rows in **Attempts**, **Recall** or **Roster** (use **Data ▸ Create a filter view** to look at subsets). Do not rename tabs or row-1 headers.
- The script never writes PINs, answers or tokens to the Log. Keep results until the program ends (Dec 2027) + 12 months, then delete or anonymise (agreed with HR).

## 13 · Updating the code later (same URL)
1. Paste the new `backend/dist/Hub.gs` over the old code (and `appsscript.json` if it changed). Save.
2. **Deploy ▸ Manage deployments** ▸ pencil (edit) on the active deployment ▸ **Version: New version** ▸ **Deploy**.
   The `/exec` URL stays the same. Do **not** use "New deployment" again: that creates a new URL.
3. Run **1% Planner ▸ Set up / repair tabs** once (adds any new columns; safe to repeat).

## 14 · Pilot tips (week of 9 Nov 2026)
- To let the pilot group sit the baseline early, open the parts with **Baseline: open or close parts…** on the pilot day and close them again afterwards. (Everyone active can start while a part is open, so open it only for the pilot session, or give the others a heads-up.)
- Each part is one attempt per wave. After the pilot, **Void an attempt…** for every pilot attempt (each part separately; the `attempt_id` is in column A of Attempts) so those people can sit the real one. A voided Part 2 also clears its self-ratings. To give a pilot person the other form in November, use **Assign a Part 1 form…**.
- Use the pilot to check the timers (`p1_minutes`, `p2_minutes`, `p3_minutes`) and the reports; change a timer in Config before the real sitting (a sitting in progress keeps its own deadline).
- Install **1% Planner ▸ Install hourly summary trigger** before people use the team page. **Rebuild summaries** updates it at once.
- Team-page numbers appear only when nobody can still change them: baseline averages only while **Results** is on (turn it on after the parts are closed), each course's checkpoint numbers after its late window closes (forum date + 7 days). Until then the team page says the numbers appear later. This stops anyone working out one person's score by comparing two snapshots.
- For the re-test (Nov–Dec 2027): set `wave` to `2027-12`, turn **Results** off, then open the parts. Each person gets the live Part 1 form they did not take in 2026; their earlier parts show as done in the earlier wave.

## The 1% Planner menu
| Item | What it does |
|---|---|
| Set up / repair tabs | creates missing tabs and columns, plain-text cells, time zone, Config defaults, course dates, episode rows |
| Import items from CSV… | paste Items / Courses / Cases / BaselineItems / Exhibits / BaselineText CSV text; then validates |
| Validate items / courses | repairs Items / Courses / Cases and the baseline tabs and lists problems (4 options, answer a–d, objective range, duplicates, counts; baseline: 32 items per live Part 1 form, two different SJT keys, rating wording, exhibits exist) |
| Seed episodes | adds missing Episodes rows from the course list |
| Refresh cache | the Hub reads Items, Courses, Config, Episodes and the baseline tabs fresh |
| Issue PINs for new roster rows | new PINs, shown once |
| Reset a PIN… | new PIN shown once, lock cleared, signed out everywhere |
| Clear a lock… | lifts a lock (including the 3-locks-in-7-days lock); the PIN stays the same |
| Unlock a retake… | code + course + who held the 15-minute chat + note → one extra attempt (also reopens a closed checkpoint) |
| (Team page, managers) | managers can now record the 15-minute chat themselves: on the Team page a report's course shows **needs chat** (third try, or the late window closed), and **Unlock** writes the same Unlocks row with the manager's code. Only for their own direct reports who are not managers |
| Void an attempt… | the attempt stops counting anywhere (pilot or technical problems); for a baseline part the person can sit it again |
| Rebuild summaries / Install hourly summary trigger | team-view numbers (groups or counts under 3, managers and test users left out; baseline numbers only while Results is on, each course's checkpoint numbers after its late window closes); while Results is on the hourly run also rebuilds the baseline profiles |
| Course gate report | `Dash_Gate`: passed / not yet / not started, first-try pass rate, three most-missed items per course |
| IDP export | `Dash_IDP`: the two baseline gaps and suggested goals per person |
| Recall due list | `Dash_Recall`: recalls due this week or overdue (Monday huddle) |
| Panel results | `Dash_Panel`: weighted team scores per stage, mean of judges (Pitch Day: communication ×2; capstone: result and value ×2). Never shown on the Hub |
| Baseline: open or close parts… | one dialog with Part 1, Part 2, Part 3, Manager rating and Results: shows the current state, saves the Config switches and refreshes the cache |
| Assign a Part 1 form… | code + form (A/B/C) + reason → an Overrides row used at the person's next Part 1 start (the only way to the backup form) |
| Build baseline profiles | grades expired sittings, equates Part 1, writes the Profiles tab (also hourly while Results is on) |
| Baseline v2 reports | `Dash_BL2_Heatmap`, `Dash_BL2_Items`, `Dash_BL2_Forms`, `Dash_BL2_Raters`, `Dash_BL2_Flags` |

## Troubleshooting
- **"Missing tab …"** in the Log or the Hub shows a server error: run **Set up / repair tabs**.
- **A change in Items/Courses/Config does not show**: **Refresh cache**.
- **"This part has no questions yet"** or **"No Part 3 module is set for you yet"**: BaselineItems is empty or inactive for that part, or the person has neither `role_area` nor `p3_module`.
- **Someone is locked out**: a first or second lock ends by itself (15 / 30 min). After 3 locks in 7 days the code stays locked: use **Clear a lock…** (PIN known) or **Reset a PIN…** (PIN forgotten).
- **"busy"** in the Hub: many people saved at the same moment; the Hub retries automatically.
- **Permission error mentioning `getActiveSpreadsheet`** after deploying: in `appsscript.json` replace `spreadsheets.currentonly` with `https://www.googleapis.com/auth/spreadsheets`, save, run `setupSheet` once to re-authorise, then redeploy (step 13).
- **The Hub feels slow**: every page asks the web app for the person's data, and Apps Script takes 1–3 s per call (up to ~8 s when nobody has used it for a while). Keep the code current (step 13), and keep the data tabs lean: no formulas, conditional formatting, filters or extra blank columns in Roster, Attempts, Watched, Recall, Teams or Capstone (each page reads them whole), and never paste images or long notes into them. To see a call's time, open the `/exec` URL: it answers in well under a second once the script is awake.

## Alternative: deploy from a terminal with clasp
For later updates without copy-paste (needs Node.js):
```sh
npm install -g @google/clasp
clasp login                                      # opens the browser once
# in the repository root, create .clasp.json (git-ignored):
#   {"scriptId": "<Project Settings ▸ IDs ▸ Script ID>", "rootDir": "backend/dist"}
node tools/bundle_backend.mjs                    # rebuild backend/dist/
clasp push                                       # uploads Hub.gs and appsscript.json
clasp deployments                                # note the web-app deployment id
clasp deploy --deploymentId <id> --description "v2"   # same URL, new version
```
