# 18 · Security and privacy checklist (tick before launch)

- [ ] The repository contains no names, employee codes, scores, answer keys, item texts or Marico business data (search: `answer`, `why_en`, `Shampoo X before`, `bn VND`, `lost sales`, `budget`, digits patterns of employee codes).
- [ ] `content-private/` is ignored by git and the pre-commit check is installed.
- [ ] The Sheet is shared only with Quân (owner) and HR L&D (editor). Link sharing is OFF.
- [ ] Apps Script deployment: Execute as Me; Anyone; the script never logs PINs or answers.
- [ ] `start` responses contain no `answer` or `why` field (automated test + manual check in the browser network tab).
- [ ] PINs are hashed with a per-person salt; 5 failures lock for 15 minutes; first login forces a PIN change.
- [ ] Session tokens expire after 6 hours; logout clears `sessionStorage`.
- [ ] Team views suppress groups with n < 3 and always exclude managers.
- [ ] Managers' own results are visible only to themselves, Quân and HR.
- [ ] No third-party scripts on the Hub (only Google Fonts CSS).
- [ ] The about page states plainly who sees what, in EN and VI.
- [ ] IT has confirmed that Google Apps Script web apps and GitHub Pages are allowed on Marico devices (or the Microsoft Forms fallback is in place).
- [ ] Data retention agreed with HR: Attempts and SelfRatings kept until the program ends (Dec 2027) + 12 months, then deleted or anonymised.
