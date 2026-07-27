# CLAUDE.md - working rules for agents in this repo

This repo builds the Strudel family of Ableton Live devices on top of the
`m4l-jweb` library (its own repo, sibling checkout). Start with `README.md`, then
`doc/ARCHITECTURE.md` for how the layers fit, and `doc/TODO.md` for what is in
flight. This file is only the house rules - the things that are not derivable
from the code.

## Asking for a test in Live

Nothing here can be proven without Live, so a change lands as a build to be
tested by hand. Make that request SCHEMATIC:

1. Name the EXACT device - `alienmind-gugelhupf`, not "the device".
2. A table, and little else: check number, what to do, what should happen.
3. One line on what is expected to still be broken at this stop.
4. Ask for the result by check NUMBER, plus the Max console output.

Do NOT re-explain how Live works. In particular, never repeat that Live embeds a
copy of a device per set, or that an existing instance has to be deleted and
re-dragged to pick up a build. That is known.

Example of the whole thing:

> Test **`alienmind-gugelhupf`**.
>
> | # | Do this | Should happen |
> |---|---------|---------------|
> | 1 | Press REPL, evaluate `note("c3 e3 g3").s("sawtooth")` | Sound on the track |
> | 2 | Save the set, reopen it | The pattern comes back |
>
> Expected still broken: the mini view's own engine still sounds separately.

## Scratch work goes in `tmp/`

Anything exploratory - an unpacked `.amxd`, a standalone spike, a scratch harness, a
dump you are reading once - goes under `tmp/`, which is gitignored. Not the repo root.

A spike that answered its question is DELETED once the answer is written down (in
`doc/MAX-FACTS.md` upstream, or `doc/DRAWER_OF_FAILED_IDEAS.md` here). The finding is
what has value; the scaffolding that produced it is noise in a tree everyone else has
to read.

## Commit messages

**Commit messages are not for literature. For that we have the markdown.**

ONE LINE. `type: what changed`, stated plainly. No body.

    feat: open external links in default browser
    fix: release a dial when its slider is deleted
    docs: clarify launchbrowser URL behavior
    chore: remove orphaned Studio windows and update TODO

No scope suffix by default (`feat:`, not `feat(strudel):`). The subject STATES, it does
not argue: "remove orphaned Studio windows", not "drop the orphaned Studio windows,
because nothing could open them any more".

Everything you were about to put in the body already has a home: the constraint goes in
a comment at that line, the measurement in `doc/MAX-FACTS.md` or `doc/ARCHITECTURE.md`,
the dead end in `doc/DRAWER_OF_FAILED_IDEAS.md`, the remaining work in `doc/TODO.md`,
and the case for the change in the PR summary. A commit says what changed; the repo says
why.

## Pull request summaries

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

## Writing

Plain ASCII punctuation in documentation, commit messages and code comments. No
em dashes, en dashes, middle dots or typographic ellipses - use `-`, `...`, `,`.
Signal-flow arrows (`->`) and glyphs standing for real UI buttons are fine.

Comments should say what the code cannot: the constraint, the trap, the thing
that was measured in Live and cost a day. Not what the next line does.
But never use cliche formulas like "this is the trap that costed us a day".
Just state the point without overextending it.

Commit messages should be schematic, one line per feature, prepend with prefixes such as:
doc -, chore -, feat -, fix -. No overextending in the commit messages. Details are
for the markdown documents.

## Recording what was learned

`doc/TODO.md` is the live ledger: what passed, what it measured, and the exact
next test. Finished work is DELETED from it rather than kept as a done-list - git
history is the record of what shipped. We may move some of the contents to some of the
following files.

`doc/DRAWER_OF_FAILED_IDEAS.md` is for approaches that were tried and did not
work, WITH the reason. A failure recorded there is worth as much as a feature -
it is what stops the same spike being run twice.

`doc/ARCHITECTURE.md` is for implementation details of everything that became a feature
and its worth noting for the future. This is the "How" is implemented, with the juicy
technical - code-based details.

`doc/README.md` is TODO items that actually became a feature that is high-level worth
mentioning for a final user because its directly observable.
We don't log implementation details here, that's for the architecture document above.

## The two repos

`m4l-jweb` is the library and this is its consumer. While both move together they
are linked (`link:../m4l-jweb/packages/*` in `package.json`), so an edit there is
live here with no publish.

Anything general - patcher codegen, the Surface, window primitives, the wrapper
protocol - belongs UPSTREAM in `m4l-jweb`, not here. Anything about these
particular devices belongs here. When in doubt, ask whether another device repo
would want it.
