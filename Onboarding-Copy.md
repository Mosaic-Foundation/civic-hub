# Onboarding copy — Floyd Civic Hub

Working doc for pinning down the new-user onboarding language. **Edit the `Final:` line under each field.** Leave `Current:` / `Suggested:` for reference. When you're ready, tell me "apply the onboarding copy" (or "read the doc") and I'll pull your `Final:` lines and implement them.

**Legend:** `env` = you set it in Vercel + `.env` (I can't) · `code` = I edit the source directly.

The full new-user path: **1** first-visit popup → **2** enter email → **3** enter code → **4** residency + policies → **5** word-cloud step → feed.

---

## Screen 1 — First-visit popup
*The very first thing a newcomer sees, before signing up. Highest-impact copy.*

### Heading — `code + env`  (IntroPopup renders "Welcome to the " + the hub name)
- Current: `Welcome to the Floyd Civic Hub.`
- Final: `Welcome to the Floyd Civic Hub.`

### Body — `env`  (VITE_HUB_INTRO_BODY)  ✅ LOCKED — code default updated. Env edit batched to end: update ui/.env only (no Vercel override exists, so ui/.env covers prod too).
- Current: `This is where Floyd County residents weigh in on local issues, read Board of Supervisors meeting summaries, and stay in the loop between elections.`
- Suggested v1 (Claude): `A calm, structured place to follow Floyd County government and shape it — read plain-language Board of Supervisors meeting summaries, raise the issues and projects that matter to you, vote on what the community decides, and see where Floyd actually stands. Not social media.`
- Suggested v2 — tighter/active alt: `Keep up with Floyd County government, raise the topics that matter, turn conversations into clear outcomes, and see where the community stands.`
- Final: `This is where Floyd County residents keep up with county government, raise topics that matter, help make sense of issues together, and have conversations to see where our community stands.`

---

## Screen 2 — Sign-up: enter email

### Heading — `code`  (AuthModal)
- Current: `Create an account to participate`
- Final: `Create an account to participate`

### Subtext — `code`
- Current: `Enter your email to get started. We'll send you a verification code.`
- Final: `Enter your email to get started. We'll send you a verification code.`

---

## Screen 3 — Sign-up: enter code

### Heading — `code`
- Current: `Check your email`
- Final: `Check your email`

### Subtext — `code`  ({email} is filled in live)
- Current: `We sent a 6-digit code to {email}`
- Final: `We sent a 6-digit code to {email}`

---

## Screen 4 — Residency + policies

### Heading — `code`
- Current: `One last thing`
- Final: `One last thing`

### Intro line — `env`  (VITE_HUB_RESIDENCY_INTRO)  ✅ LOCKED — code default updated; env edit batched to end (ui/.env)
- Current: `To participate in Floyd County civic processes, please confirm your residency and review the policies below.`
- Final: `To participate in the Floyd Civic Hub, please confirm your residency and review the policies below.`

### Checkbox — `code`  ({jurisdiction} + linked policy names are filled in)
- Current: `I confirm that I am a resident of {jurisdiction}, and I have read and agree to the Terms of Service, Privacy Policy, and Code of Conduct.`
- Note: residency attestation + legal acceptance are bundled in one checkbox — flagged for your pro-bono legal review; can split into two if you want.
- Final: `I confirm that I am a resident of {jurisdiction}, and I have read and agree to the Terms of Service, Privacy Policy, and Code of Conduct.`

---

## Screen 5 — Word-cloud step
*Shown right after sign-up. Optional; they can skip to the feed. On prod the cloud starts blank, so a new tester is genuinely first.*

### Skip link — `code`  (WordCloud)
- Current: `Skip →`
- Final: `Skip →`

### Banner heading — `code`  ✅ LOCKED — applied to WordCloud.tsx
- Current: `Welcome! You're all set.`
- Suggested (Claude): `One quick thing before you dive in`
- Final: `One quick thing before you dive in`

### Banner body — `code`  ✅ LOCKED — applied to WordCloud.tsx
- Current: `Before you explore, we'd love to hear from you. This is optional — add a word or phrase below, or skip to the feed.`
- Suggested (Claude): `This is optional — tell us in a few words what you love about Floyd, or skip straight to the feed.`
- Final: `This is optional — tell us in a few words what you love about Floyd, or skip straight to the feed.`

### Prompt (shown above the input) — `code / data`
- Current: `In a few words, what do you love about Floyd?`  (the word-cloud process's own prompt)
- Note: this duplicates the cloud's title "What do you love about Floyd?" on the same screen. Could drop one for less repetition.
- Final: `In a few words, what do you love about Floyd?`

---

## Env edits to apply at the end (batched)
*Copy strings live in code (Claude edits those directly). These `env` strings you paste once we're done. `ui/.env` is committed, so for fields with no Vercel override it also covers prod on the next deploy.*

- **`ui/.env`** → `VITE_HUB_INTRO_BODY` = `This is where Floyd County residents keep up with county government, raise topics that matter, help make sense of issues together, and have conversations to see where our community stands.`  *(no Vercel override → covers prod too)*
- **`ui/.env`** → `VITE_HUB_RESIDENCY_INTRO` = `To participate in the Floyd Civic Hub, please confirm your residency and review the policies below.`  *(no Vercel override → covers prod too)*

---

## Open questions (jot answers here or tell me in chat)
- Screen 1 body — does the rewrite land? Keep "Not social media" kicker? →
- Screen 5 — keep a warm "Welcome!" beat, or the calmer "one quick thing"? →
- Screen 4 — split residency and legal into two checkboxes now, or later with the lawyer? →
- `welcome.md` (the full /welcome page) — reconcile its proposal→vote description to the current model? →
