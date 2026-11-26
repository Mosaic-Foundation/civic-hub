# Release checks

What used to be a walk through dev by hand before a release, and which part of it a test now does.
The tests are `tests/e2e/releaseChecks.spec.ts`. They run with the rest of the browser tests (the E2E workflow) on every
push to dev, and on any branch by hand (Actions → E2E → Run workflow), against a new demo hub with sample content that
they make and put away.

## Covered by the browser tests

| Check | Test |
| --- | --- |
| Every content type opens from its link (`/process/:id`, the link activities, emails and search use) and lands on its own page with its title: votes, proposals, projects, conversations, word clouds, events, meeting summaries, briefs, announcements. On a desktop and at phone width, with nothing wider than the screen. | 1 |
| A resident takes part: casts a vote, endorses a proposed vote, supports a proposal and a project, answers the word cloud, says they're going to an event. A finished vote shows its result and no ballot. | 2 |
| The feed's filter pills: each shows only its kind, All brings everything back. | 3 |
| A new person signs up: no About you card on the way, they land on the onboarding word cloud, the account exists. | 4 |
| Pinning, Search, Feedback, Members and Admin digest each switch off and back on in Hub settings → Plugins; what each shows goes and comes back; the feed and a vote page keep working throughout. | 5 |
| An urgent pin is the line across the top of the home page and a vote page, on a desktop and a phone, linked to the item; unpinned, it goes. | 6 |

The release script (`scripts/release.sh`) already checks, on the deployment itself: migrations, `/api/health` with no
schema gaps, how many plugin packages are mounted and that each runs on a signed approval, and the JSON 404. The dev
smoke suite (GitHub → Actions → Smoke) runs against the deployment after each one.

## Still needs a person

- **Approving plugin versions in the console** when the release can't sign them itself. The release summary says
  "dev mounts N of M"; it should be all of them.
- **News items.** They are copied in from another site's feed, which a test hub doesn't have. Open one on dev.
- **A conversation's own voting.** It runs on Polis, an outside service the tests replace with a stand-in.
- **Real email.** Sign-in codes on a beta or live hub, the resident and admin digests. Tests use a demo hub, where any
  six digits sign in, and a stand-in for the mail service.
- **How it looks.** Layout, colours, dark mode, and a real phone rather than a narrow window. The tests check that
  things are there and work, not that they look right.
