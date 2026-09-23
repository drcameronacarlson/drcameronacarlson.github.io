# Google Play listing — MoBoard Bridge Trainer

Everything Play Console asks for, ready to paste. Items marked **[YOU]** need your input.

## App details

| Field | Value |
| --- | --- |
| App name (max 30) | MoBoard Bridge Trainer |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Category | Education |
| Tags (pick up to 5) | Education, Navigation, Simulation, Study aids, Science & maths |
| Contact email | **[YOU]** (shown publicly on the listing) |
| Website (optional) | **[YOU]** the GitHub Pages address once it exists |
| Privacy policy URL | **[YOU]** `https://<your-site>/privacy.html` (the page is in the `site` folder; fill in the contact email in `privacy.html` first) |

## Short description (max 80 characters)

```
Maneuvering board trainer: 3D bridge view, live radar & graded MoBoard problems
```
(79 characters)

## Full description (max 4,000 characters)

```
Learn the maneuvering board the way you will use it on watch: solve the problem, then watch it play out from the bridge.

MoBoard Bridge Trainer is a self-study and classroom tool for midshipmen, officer candidates and junior officers learning relative motion. Every problem is loaded into a live scenario, so you can work it on paper or on the built-in digital board, check your answers, and then run your own solution to see whether the contact really passes where you said it would.

THREE LINKED VIEWS
• Bridge window — look out from the bridge in 3D, sweep the horizon, raise binoculars, and watch contacts come over the horizon. Navigation lights show correctly at dusk and night.
• Radar — a live display with range rings, relative-motion trails, target vectors, and an electronic bearing line and variable range marker.
• Maneuvering board — a full digital MoBoard with distance and speed scales, pencil tools, and step-by-step solution overlays in the standard e-r-m speed triangle.

21 PROBLEM TYPES, ENDLESS PRACTICE
Every problem is randomly generated and solved exactly, with a worked solution:
• Relative motion: contact analysis and CPA, time to reach a set range, course or speed to open CPA, clearing two contacts at once, intercept, closest approach when you can't intercept
• Stationing: change station at a set speed, in a set time, or at minimum speed; two-leg station changes; screen sectors; scouting and return
• Wind: true wind, apparent wind, and course and speed for a desired wind over the deck
• DIVTACS: formation changes, axis rotation, TURN and CORPEN signals
• Shiphandling: advance and transfer from tactical diameter

BUILT FOR SELF-STUDY
• Hints that reveal one step at a time and draw that step on the board
• "Coach me" mode checks each answer as you enter it
• Every problem is timed, so you build the speed you need on watch
• A readiness path tracks mastery: three fully correct answers in a row, without hints
• A timed qualification exam produces a completion code to send your instructor

FOR INSTRUCTORS
• Build an assignment from any mix of problem types, or enter exact problems from your own materials
• Share one code: every student gets the same numbers
• Paste back students' completion codes to get a class roster you can copy into a spreadsheet

WORKS ANYWHERE
Phone, tablet or laptop. After the first launch it works offline. No account, no ads, and no data collection — your progress stays on your device.

MoBoard Bridge Trainer is an independent training aid. Always use official publications and your command's procedures for navigation and ship handling.
```

## Graphics (all in this `store` folder)

| Play Console slot | File | Size |
| --- | --- | --- |
| App icon | `../icons/play-store-icon-512.png` | 512×512 |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 |
| Phone screenshots (2–8) | `phone-1-split.png` … `phone-5-progress.png` | 1080×1920 |
| 7-inch and 10-inch tablet screenshots | `tablet-1-split.png`, `tablet-2-moboard.png` | 2560×1600 |

Suggested phone screenshot order and captions (Play doesn't show captions, but they're handy for a website):
1. `phone-1-split.png` — Bridge and radar with a live CPA problem
2. `phone-2-moboard.png` — Worked solution on the maneuvering board
3. `phone-3-bridge.png` — Binocular view of a contact from the bridge
4. `phone-4-radar.png` — Radar with trails and target data
5. `phone-5-progress.png` — Readiness path and qualification exam

To regenerate them after app changes, open the hosted app with `#demo-split`, `#demo-moboard`, `#demo-bridge`, `#demo-radar` or `#demo-progress` at the end of the address.

## Policy questionnaires (answers for this app)

**Data safety**
- Does your app collect or share any of the required user data types? **No**
- Is all user data encrypted in transit? Not applicable (no user data is transmitted)
- Account deletion: not applicable (no accounts)

**Content rating (IARC questionnaire)**
- Category: Reference, News, or Educational
- Violence, sexual content, profanity, drugs, gambling: **No** to all
- Does the app let users interact or exchange content? **No** (codes are copied manually outside the app)
- Shares user location? **No**
- Expected rating: Everyone / PEGI 3

**Target audience and content**
- Target age group: **18 and over** (recommended). Choosing under-13 groups triggers Google's Families policy requirements, which aren't needed for a midshipman trainer.
- Appeals to children? **No**

**Ads**: No ads.

**App access**: All functionality is available without special access (no login).

**Government apps**: Answer **No** unless it is being published on behalf of a government body. **[YOU]** Check with your chain of command if it will carry Navy/NROTC branding or be distributed as an official resource.

## Release checklist

1. [ ] Play developer account verified **[YOU]**
2. [ ] Contact email added to `privacy.html` **[YOU]**
3. [ ] `site` folder uploaded to GitHub Pages (account site `yourname.github.io`, or a custom domain)
4. [ ] PWABuilder package generated from the live URL → `.aab`, signing key (back it up!), `assetlinks.json`
5. [ ] `assetlinks.json` saved to `.well-known/assetlinks.json` in this folder, `build-site.ps1` re-run, site re-uploaded
6. [ ] Play Console: create app, paste listing, upload graphics, complete questionnaires
7. [ ] Upload `.aab` to Closed testing; add 12+ testers; run for 14 days
8. [ ] Apply for production access
