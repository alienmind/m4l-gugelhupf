---
name: pr-summary
description: How to write a pull request summary for this repo - the title format, the Fix/Enhancement/Cleanup classification, saying why rather than only what, and what to leave out. Use when opening a PR, writing a release summary, or drafting the description for a branch that is about to be reviewed.
---

# Pull request summaries

CLAUDE.md's "Writing" section applies to everything here, and its "Say why, not only
what" applies FIRST. A PR summary is usually the only place the reason for a change is
ever written down. Read it before this.

Title: `<version> - <the areas that changed>`, plainly. "1.1.0 - better external windows
and declarative controls", not a metaphor and not personification.

CLASSIFY EVERY ENTRY, and lead with the fixes. Three headings, numbered within each
kind, in this order:

    ## Fix 1 - <the symptom, in the reviewer's terms>
    ## Enhancement 1 - <what it now does, or what it lets us do>
    ## Cleanup

A reviewer's first question is what was broken, so a release that repairs something
opens on that, not on its nicest new API. `## Fix` for something that was wrong,
`## Enhancement` for something that was merely absent, `## Cleanup` once at the end for
deletions - no number, they do not need ranking.

## The heading names the payoff, not the plumbing

A reviewer who has never opened the file should recognise the problem, or the gain, from
the heading alone. What moved is in the diff; what it bought is not.

| Was | Should be |
|---|---|
| "add latency to obj-jweb" | "the device page's `[jweb~]` can carry a `latency` - no more hiccups in the mini window playing a tune" |
| "the library comes from npm, not from a path on one machine" | "built from latest m4l-jweb v1.6.1 so we have options to map Strudel sliders and actions to the Push control surface" |
| "`open_url` was defined twice, and the build stopped" | "`open_url` moved upstream so we drop it" |
| "the installer in the ZIP said 'No .amxd found' on a good download" | "fixed the installer included in the ZIP - 'No .amxd found'" |

ONE TO THREE SENTENCES under each. Say what it now does and what it is FOR; add the
mechanism only where it is what makes the change make sense. Then stop - the diff is
attached, and anything further is being read instead of the code.

Lead with the reason where the reason is the point: "This was needed during investigation
on macOS where the device view was not fitting, so each device now posts a diagnostics
block" beats the same sentence with the reason at the end.

Write as the team. "We" is correct, not a lapse. And say it as honestly as you know it -
if a change is an investigation aid and not a fix, call it one.

## Leave out

- The opening paragraph saying what the release is for. The headings already say it.
  (This bans a PREAMBLE, not the reason for each entry - every entry still says why.)
- Proof of work. No "measured in Live", no "verified", no "confirmed in both
  directions", no "byte for byte", no test counts, no "CI proves it from a clean
  checkout", no Review notes section. The diff and the CI say that.
- Error codes and internal detail. `TS2393`, which packages a lockfile resolved and at
  what version. Name an error code only when the reader would search for it.
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
