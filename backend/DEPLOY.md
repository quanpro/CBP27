# Deploying the Hub backend (step by step, for Quân)

This puts the backend (grading, retake rules, privacy) into **your** Google account, next to a private Google Sheet. You need no Apps Script experience. Allow about 45 minutes the first time.

**What you need**
- Your Google account, with 2-step verification switched on.
- From this repository: `backend/dist/Hub.gs` and `backend/dist/appsscript.json` (open each on GitHub ▸ **Raw** ▸ select all ▸ copy).
- From your private folder (never from GitHub): `Items.csv`, `Courses.csv`, `Cases.csv`.

> Never upload the CSV files, PINs or anything from the Sheet to GitHub. The repository is public.

---

## 1 · Create the Sheet
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
Do this for **Items**, **Courses** and **Cases**, one at a time:
1. Click the tab (for example **Items**).
2. **File ▸ Import ▸ Upload** ▸ choose `Items.csv`.
3. Import location: **Replace current sheet**. Separator: **Comma**. **Untick "Convert text to numbers, dates and formulas"**. Press **Import data**.

Then run **1% Planner ▸ Validate items / courses**. It puts back the plain-text format, refills the Courses calendar columns that the import removed (order, cycle, online_from, checkpoint_close, forum_date, field_until, open) and lists any problems. You want "✔ No problems". Warnings about counts mean a course has fewer or more items than the blueprint (4 baseline, 3 predict, 10 per checkpoint form).

Alternative: **1% Planner ▸ Import items from CSV…** lets you paste the CSV text instead (Courses rows are then updated by code and keep your dates and links).

## 7 · Check Courses, Episodes and Config
- **Courses**: the calendar dates come from the public course list. Paste each course's Blink playlist link into `blink_url` when HR has it. `open = TRUE` means the course opens by itself on `online_from`; set `FALSE` to hold a course back.
- **Episodes**: one row per episode (ep 0 = trailer). Paste the Blink link into `blink_url`, and an embeddable player link into `embed_url` if Blink allows it (otherwise leave it empty: the Hub shows a "Watch on Blink" card). `minutes` is optional.
- **Config** (one row per setting; edit the `value` column):

| key | default | meaning |
|---|---|---|
| wave | 2026-11 | baseline wave (re-test: 2027-12) |
| baseline_open_from / baseline_open_to | 2026-11-16 / 2026-11-27 | baseline window, open until 23:59:59 on the last day (re-test 2027-11-29 / 2027-12-10) |
| pass_mark | 0.8 | checkpoint pass mark (8 of 10) |
| retake_hours | 24 | wait between checkpoint attempts |
| max_free_attempts | 2 | the 3rd attempt needs an unlock |
| late_days | 7 | the checkpoint stays open until forum date + 7 days (later attempts need an unlock). The correct answers are shown only to people who have passed |
| team_view_min_n | 3 | smallest group shown in team views |
| session_hours | 6 | how long a login lasts |
| baseline_minutes / baseline_grace_minutes | 60 / 10 | baseline timer and server grace |
| recall_days | 2,7,30 | recall days after the forum (or after a late pass) |
| pitch_deadline / capstone_deadline | 2027-06-21 / 2027-12-20 | last day to submit |
| lock_failures | 5 | wrong PINs before a lock: 15 min, then 30 min; the **3rd lock within 7 days stays until you clear it** (see step 9) |
| streak_skip_weeks | 2027-02-08 | Mondays of weeks (comma-separated) that neither break nor add to a learner's weekly streak, e.g. the Tết week; leave empty for none |

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
| manager_code | the person's manager's code |
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
- To let pilot users take the baseline early, set `baseline_open_from` to the pilot day, **Refresh cache**; afterwards set it back to `2026-11-16`.
- The baseline is one attempt per wave. After the pilot, **Void an attempt…** for each pilot baseline so those people can take the real one.
- Install **1% Planner ▸ Install hourly summary trigger** before people use the team page. **Rebuild summaries** updates it at once.
- Team-page numbers appear only when nobody can still change them: baseline averages after the baseline window closes (plus the 70-minute timer), each course's checkpoint numbers after its late window closes (forum date + 7 days). Until then the team page says the numbers appear later. This stops anyone working out one person's score by comparing two snapshots.
- For the re-test (Nov–Dec 2027): set `wave` to `2027-12` and the window to `2027-11-29` / `2027-12-10`. The same items are used; each person's earlier result shows next to the new one.

## The 1% Planner menu
| Item | What it does |
|---|---|
| Set up / repair tabs | creates missing tabs and columns, plain-text cells, time zone, Config defaults, course dates, episode rows |
| Import items from CSV… | paste Items / Courses / Cases CSV text; then validates |
| Validate items / courses | repairs Items / Courses / Cases and lists problems (4 options, answer a–d, objective range, duplicates, counts) |
| Seed episodes | adds missing Episodes rows from the course list |
| Refresh cache | the Hub reads Items, Courses, Config and Episodes fresh |
| Issue PINs for new roster rows | new PINs, shown once |
| Reset a PIN… | new PIN shown once, lock cleared, signed out everywhere |
| Clear a lock… | lifts a lock (including the 3-locks-in-7-days lock); the PIN stays the same |
| Unlock a retake… | code + course + who held the 15-minute chat + note → one extra attempt (also reopens a closed checkpoint) |
| (Team page, managers) | managers can now record the 15-minute chat themselves: on the Team page a report's course shows **needs chat** (third try, or the late window closed), and **Unlock** writes the same Unlocks row with the manager's code. Only for their own direct reports who are not managers |
| Void an attempt… | the attempt stops counting anywhere (pilot or technical problems) |
| Rebuild summaries / Install hourly summary trigger | team-view numbers (groups or counts under 3, managers and test users left out; published only after the baseline window / each course's late window closes) |
| Baseline heatmap | `Dash_Baseline`: people × courses, self-rating, calibration flags |
| Course gate report | `Dash_Gate`: passed / not yet / not started, first-try pass rate, three most-missed items per course |
| IDP export | `Dash_IDP`: two largest gaps and suggested capability goals per person |
| Recall due list | `Dash_Recall`: recalls due this week or overdue (Monday huddle) |
| Panel results | `Dash_Panel`: weighted team scores per stage, mean of judges (Pitch Day: communication ×2; capstone: result and value ×2). Never shown on the Hub |

## Troubleshooting
- **"Missing tab …"** in the Log or the Hub shows a server error: run **Set up / repair tabs**.
- **A change in Items/Courses/Config does not show**: **Refresh cache**.
- **Someone is locked out**: a first or second lock ends by itself (15 / 30 min). After 3 locks in 7 days the code stays locked: use **Clear a lock…** (PIN known) or **Reset a PIN…** (PIN forgotten).
- **"busy"** in the Hub: many people saved at the same moment; the Hub retries automatically.
- **Permission error mentioning `getActiveSpreadsheet`** after deploying: in `appsscript.json` replace `spreadsheets.currentonly` with `https://www.googleapis.com/auth/spreadsheets`, save, run `setupSheet` once to re-authorise, then redeploy (step 13).

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
