# Privacy Policy

*Last updated: 2026-10-14*
*Version: 1.3*

{{#draft}}> **Draft starter content — review before launch.** This document was drafted as a starting point and is not legal advice. Have it reviewed by a lawyer {{#place}}familiar with {STATE} and US privacy law{{/place}}{{^place}}familiar with {GOVERNING_STATE} and US privacy law{{/place}} before {THE_HUB_NAME} accepts its first {{#place}}resident {{/place}}sign-up in production. Placeholder fields marked `{LIKE_THIS}` should be filled in or removed.{{/draft}}

## In short

**What we keep**
- Your email address, to sign you in and, if you choose, to send you a digest.
- Your name. Members who are signed in see it on what you post; anyone who isn't signed in sees a plain label instead.
- What you post, and the fact that you took part in a vote.

**What we never keep**
- A password. There isn't one: you sign in with a code we email you.
- Your sign-in codes or the key that keeps you signed in, in a form anyone could use. We keep only a scrambled fingerprint of each.
- Anything that joins your account to how you voted.
- Your network (IP) address, except as a scrambled counter, kept for about two days, that stops anyone flooding the sign-in form.

**How anonymity works**
- **Your vote.** We record that you voted, and, separately, the ballot. Nothing links the two. Ballots carry no time and are shuffled.
- **Your receipt.** After voting you get a receipt code that lets you check your ballot was counted. Keep it private: depending on how the vote was set up, anyone holding the code may see the choice it recorded.
- **Anonymous comments.** Where a {{#place}}resident{{/place}}{{^place}}participant{{/place}} chooses to comment anonymously, other people don't see their name. The hub's admins can still see who wrote it, so they can act on reports under the Code of Conduct.
- **The automatic check.** When you submit something, its text (never your name or email) is checked by an AI model against the Code of Conduct.

The full policy below has the details. Questions: {CONTACT_EMAIL}.

## Who runs this site

{WHO_RUNS_THIS}

## What this policy covers

This policy describes what information we collect when you use the Hub, how we use it, who we share it with, and your rights over your information.

## What we collect

We try to collect only what's needed to run the Hub. Specifically:

**When you create an account:**
- Your email address, used to verify you and to send the daily digest if you're subscribed.
{{#place}}- Your self-affirmed claim of {PLACE} residency. We do not verify this against external records.
{{/place}}{{^place}}{{/place}}
**When you participate:**
- That you took part in a vote, and when, linked to your account, so that each person votes once.
- Your ballot, kept apart from your account: your choice and a receipt code. The receipt code is stored with the ballot, never with you, so no record links you or your email address to a choice. Ballots carry no time and are kept in shuffled order, so they can't be matched to voters by when or in what order they were cast.
- Any comments you submit, linked to your account.
- The timestamp of each action you take.

**On your device, when you vote:**
- Your browser keeps your receipt code, a key that lets you change your vote while it is open, the choice you made and the day, for each vote, under your account on that browser. This stays on your device; we never see the choice from it. Signing out keeps it, so you can still change your vote after signing back in on the same browser. Clearing your browser's data removes it: your vote still counts, but it can no longer be changed from there.
- If you download your receipt, the file has the code, the vote's name and the date, never your choice.

**When you browse the Hub:**
- Standard server logs — IP address, browser type, pages requested, referrer, timestamp. Logs are retained for 90 days, then deleted.
- A session cookie that keeps you signed in. We do not use third-party tracking cookies or advertising cookies.

**When admins generate AI content (meeting summaries, vote results):**
- The minutes PDFs, YouTube transcripts, and vote tallies used as input to Anthropic's Claude API. These documents are already public; we transmit them to Claude only for summarization.

## What we do not collect

- We do not track you across other websites.
- We do not buy or sell personal data.
- We do not serve advertising and do not share data with advertisers.
- We do not collect precise location data.
- We do not require you to install any tracking or analytics software.

## How we use your information

- **Authentication** — to verify your email and keep you signed in.
- **Participation** — to record your votes and comments as part of the civic record.
- **Communication** — to send the daily digest (if subscribed), one-time verification codes, and occasional administrative messages about the Hub itself.
- **Operations** — to keep the site running, diagnose problems, and prevent abuse.
- **Public civic record** — votes and comments may be displayed publicly as part of civic processes (see "Public vs. private information" below).

We do not use your information for any other purpose without first telling you and getting your consent.

## Public vs. private information

**Private (visible only to you and to hub admins):**
- Your email address.
- Your account's session and login history.
- Server log entries tied to your account.

**Public (visible to anyone, with or without an account):**
- The *aggregate* totals of votes you participate in. Example: "89 {{#place}}residents{{/place}}{{^place}}participants{{/place}} voted; 52 in favor, 37 opposed."
- The vote log of a closed vote: every ballot's receipt code, with no names. On a vote set to "Show the choice", each code is listed with the choice it recorded, so anyone holding your code can see how that ballot was cast; keep your code private. On a vote set to "Counted only", the log lists the codes alone, and a code shows only that its ballot was counted.
- Comments you submit, displayed alongside the civic process they belong to. Comments are publicly attributed to the name you choose on your profile, or pseudonymously when the process is configured for pseudonymous participation. We will document which mode is in use on each vote's page.
- Vote results and meeting summaries that an admin has reviewed and approved.

We will tell you before you participate if your contribution will be attributed publicly.

## Who we share information with

We use a small number of trusted service providers to run the Hub. Each one receives only the data needed to do its job:

- **Supabase** — database and authentication (stores your email, account metadata, votes, comments).
- **Vercel** — web hosting (processes page requests, writes short-lived server logs).
- **Resend** — email delivery (receives your email address and the digest contents when we send you a digest).
- **Anthropic** — AI processing for meeting summaries and vote-results generation. Anthropic receives public meeting documents and vote tallies; it does not receive your personal account information.

We do not share your information with any other third party except:
- When we have your explicit permission.
- When required by law (subpoena, court order, or lawful government request).
- To protect the safety or rights of users or the public.

If the Hub is ever acquired, transferred, or wound down, we'll notify you by email at least 30 days in advance and give you a chance to export or delete your data before the transition.

## How long we keep your data

- **Account data (email, residency claim)** — as long as your account is active, plus one year after deletion to honor account-recovery requests and to comply with legal obligations.
- **Ballots** — retained indefinitely as part of the count. A ballot never carries your name, so deleting your account does not change it. The record that you took part in a vote stays after you delete your account, without your name.
- **Comments** — retained indefinitely as part of the public civic record. Deleting your account removes your name from these entries but does not remove the entries themselves (they become attributed to "former participant"). If you want your comment fully removed, contact us and we'll evaluate the request.
- **Server logs** — 90 days, then deleted.
- **Email verification codes** — stored only as a scrambled fingerprint. Each works once, for ten minutes, and is deleted when used.
- **Session tokens** — stored only as a scrambled fingerprint, and deleted when you log out. Otherwise a session ends after 7 days, or 90 days if you chose "Keep me signed in".

## Your rights

You have the right to:

- **Access** — ask for a copy of the data we have about you.
- **Correct** — tell us to fix inaccurate information.
- **Delete** — close your account and have your personal account data deleted, subject to the civic-record retention note above.
- **Opt out of the digest** — at any time, either through the Settings page or via the one-click unsubscribe link in every digest email.
- **Complain** — to us directly (we'll take it seriously) {{#place}}or to the {STATE} Attorney General's office.{{/place}}{{^place}}or to your state's Attorney General.{{/place}}

To exercise any of these rights, email {CONTACT_EMAIL}. We'll respond within 30 days.

## Children

The Hub is intended for people age 13 and older. We do not knowingly collect information from children under 13. If you believe a child under 13 has created an account, please contact us and we'll delete the account promptly.

Some civic activities — notably advisory votes — may be further restricted to adults by the process itself. Each vote will state its eligibility rules clearly.

## Security

We take reasonable precautions to protect your information: encrypted connections (HTTPS), password-less authentication via email codes, and access controls on our hosting and database providers. No system is perfectly secure, and we don't guarantee that unauthorized access will never happen. If a breach occurs that affects you, we'll notify you promptly.

## Changes to this policy

We may update this policy as the Hub evolves. Material changes will be announced on the Hub and, if the change affects how we use your data, we'll email you before it takes effect. The "Last updated" date at the top of this document always reflects the most recent revision.

## Contact

For privacy questions, data requests, or concerns about this policy:

{OPERATOR}
{CONTACT_EMAIL}

---

*This policy applies to {THE_HUB_NAME} at {HOSTNAME}. {{#place}}It does not apply to the {PLACE} government website or to any other site we link to.{{/place}}{{^place}}It does not apply to any other site we link to.{{/place}}*
