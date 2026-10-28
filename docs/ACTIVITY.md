# Activity and Public numbers (for hub admins)

The source for the docs site's Activity section. The help notes in the admin panel (`plugins.analytics`,
`plugin.analytics.public_numbers` in `src/shared/helpRegistry.json`) link to the anchors below; until the docs site
publishes them, they are marked pending.

## Activity {#plugins-analytics}

Admin → Activity shows how many residents took part in your hub, and in what, counted from the hub's own record.
Every number is a count. None of them names anyone, and nothing on the page lists who did or did not take part.

**Periods.** Choose a week (Monday to Sunday), a month, a quarter or Since launch, in your hub's time zone. Since
launch starts on the day your hub first left demo, or the day it was created if it never was a demo. The arrows step
to the period before or after. The current period is counted so far. The numbers are recounted every hour; when the
hourly count has not run lately, the current period is counted from the record as you open the page ("Counted just
now"), so a hub with activity never shows zeros. **Recount now** counts them again straight away and keeps them.

**The totals.**
- **Active residents:** people with an account on this hub who took part or started something in the period. Admins
  reviewing or publishing are not taking part.
- **New residents:** accounts that joined the hub in the period.
- **Participations:** each act of taking part counts once: a vote, a support, a view on a project, a word, a comment, a
  submission. A conversation's participants are counted from the total its brief records, because they take part in
  Polis, not on the hub.
- **Processes created** and **closed**, and **results and briefs** (results published, briefs delivered to officials).

**By kind** shows the same numbers for each kind of process.

**For funders** shows three things civic surveys ask people to remember, counted instead from what the hub recorded:
- *Attended a public meeting:* participants in public conversations (a total of each conversation's participants, not
  distinct people), and the public meetings recorded. The hub does not record who attended a meeting.
- *Worked with neighbours on something:* residents who took part in a project, and how many times.
- *Contacted an official:* briefs delivered to officials, and the residents whose participation went into them.

Each has **How this is counted**: the kinds of event behind it and the period. These numbers say what happened, not how
anyone felt about it, and they count only people who took part on the hub.

**Coming back** shows how many residents took part in more than one kind of process, and how many who took part in the
period before also took part in this one.

**Download CSV** saves the period's numbers as a spreadsheet, with how each funder measure is counted.

**Where else these numbers appear.** On the first admin digest of each month, one line with last month's totals.
Civic.Social's operator sees every hub's totals in the platform console.

## Public numbers {#plugin-analytics-public-numbers}

Off by default. Turn it on with **Make the numbers public** on Admin → Activity, or in Hub settings → Plugins →
Activity.

When it is on:
- anyone can read your hub's numbers at `/analytics` on your hub's address (`/analytics?period=quarter` for a quarter);
- your About page shows **This hub in numbers**: this month and since launch.

Below admins, a number from 1 to 4 is shown as "fewer than 5", so that a small count cannot point at a person. Zero is
shown as zero. The numbers on Admin → Activity stay exact. For a small hub many lines will read "fewer than 5" for a
while: that is the rule at work, not missing data. `/analytics` says so in every answer, in its `note` field.

## Reporting keys {#activity-reporting-keys}

A reporting key lets a named outside organisation, such as a funder or a researcher, read `/analytics` even while Public
numbers is off. On Admin → Activity, give the organisation's name, a contact and what the key is for, and press
**Issue a key**. The key is shown once: copy it and send it to them. They send it with each request as
`Authorization: Bearer <the key>`.

Every read with a key is listed under **Reads with a key**: which organisation, when, and which period. **Revoke**
stops a key at once. Organisations reading with a key see the same numbers as the public, with small numbers shown as
"fewer than 5".

## Switching Activity off

Hub settings → Plugins → Activity off removes the Activity page, `/analytics` (for keys too) and the About block, and
stops the hourly count. The counts already made stay in the hub's database and come back when it is switched on.
