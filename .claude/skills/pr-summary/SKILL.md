---
name: pr-summary
description: How to write a pull request summary for this repo - the title format, the Fix/Enhancement/Cleanup classification, and what to leave out. Use when opening a PR, writing a release summary, or drafting the description for a branch that is about to be reviewed.
---

# Pull request summaries

Title: `<version> - <the areas that changed>`, plainly. "1.1.0 - better external windows
and declarative controls", not a metaphor and not personification.

CLASSIFY EVERY ENTRY, and lead with the fixes. Three headings, numbered within each
kind, in this order:

    ## Fix 1 - <the symptom, in the reviewer's terms>
    ## Enhancement 1 - <what it now does>
    ## Cleanup

A reviewer's first question is what was broken, so a release that repairs something
opens on that, not on its nicest new API. `## Fix` for something that was wrong,
`## Enhancement` for something that was merely absent, `## Cleanup` once at the end for
deletions - no number, they do not need ranking.

The heading names the EFFECT, not the symbol: "the device page's `[jweb~]` can carry a
`latency` - no more hiccups in the mini window playing a tune", not "add latency to
obj-jweb". A reviewer who has never opened the file should recognise the problem from
the heading alone.

ONE TO THREE SENTENCES under each. State what it now does; add the mechanism only where
it is what makes the change make sense. Then stop - the diff is attached, and anything
further is being read instead of the code.

LEAVE OUT:

- The opening paragraph saying what the release is for. The headings already say it.
- Proof of work. No "measured in Live", no "verified", no "confirmed in both
  directions", no "byte for byte", no test counts, no Review notes section. The diff and
  the CI say that.
- The evidence that isolated a cause. Which dial was dead while its sibling worked, what
  the before/after was - that is what makes the finding TRUE, and it belongs in the
  evidence log (`doc/MAX-FACTS.md`, `doc/DRAWER_OF_FAILED_IDEAS.md`), not in a review
  request.
- The story of getting there. What an earlier attempt got wrong, what was believed for
  months, which spike was decisive.
- A "limits that survive" section. A limit goes in the entry it belongs to, in a clause,
  or it goes in the docs.
- Emphasis for its own sake. No bold shouting, no "the non-obvious part is", no framing a
  change as a discovery.

Keep concrete numbers when they carry the argument (17 MB will not fit in a payload),
and drop them when they are just credentials.
