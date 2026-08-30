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

## Pull request summaries

The format - title, the Fix/Enhancement/Cleanup classification, and what to leave out -
is the `pr-summary` skill (`.claude/skills/pr-summary/SKILL.md`). It loads when a PR is
being written rather than sitting in every session.

## Writing

One section, and it is the same in `m4l-jweb` and `m4l-gugelhupf`. If you change it in
one, copy it to the other.

**The goal is text that reads as though a person wrote it after doing the work.** Not
text that reads as though it was generated from a diff. The rules below are what that
difference turned out to be, each one learned by having the alternative rewritten by
hand.

### Punctuation

Plain ASCII in documentation, commit messages and code comments. No em dashes, en
dashes, middle dots or typographic ellipses - use `-`, `...`, `,`. Signal-flow arrows
(`->`) and glyphs standing for real UI buttons are fine.

### Plain language

Every `.md` file here - `README.md`, everything in `doc/`, `CHANGELOG.md`, a README
beside an asset folder - is written in **plain language**. This is the rule, and it
applies to new files and to edits of old ones:

> You rewrite Markdown prose into much simpler, plain language. Write the rewrite in the
> same language as the file you are rewriting. Keep every fact, name, number, link, and
> file path. Keep all Markdown structure - headings, lists, tables, and links. Do NOT
> change fenced code blocks or any YAML frontmatter; reproduce them exactly. Use short
> sentences and everyday words. Output ONLY the rewritten Markdown, with no preamble,
> labels, or commentary.

What that rules out, since this repo has produced all of it: long sentences held
together by dashes, a clause of drama after every fact, and the same point made twice in
different words. Say the thing once, in the shortest words that are still exact.

**A heading says what the section is about. Nothing else.** This repo grew a habit of
headings that are a mood instead of a subject, and you cannot scan a document written
that way - you have to read each section to find out what is in it. All of these were
real, and all of them are wrong:

| Was | Should be |
|---|---|
| "The one constraint every use case here is shaped by" | "Claiming the matrix stops the pads playing notes" |
| "The API these are written against" | "The API" |
| "The things that will bite" | "Common mistakes" |
| "The verdict, up front" | "Verdict" |
| "The overlap, stated without flinching" | "What overlaps" |
| "What ports, and why it is more than it looks" | "What ports" |

Rules of thumb: no "the one thing that", no "stated without", no "and why", no
"up front", no "honestly", no promise about how the section will make the reader feel. If
a heading needs a comma to hold two ideas, it is two sections or one shorter heading.

The same goes for sentences. Prefer "Claiming the matrix takes the pads off the note
path" over "The one constraint every use case here is shaped by is that claiming the
matrix takes the pads off the note path." Start with the subject.

### No riddles

**A title is not a puzzle to be solved by reading the section.** This repo wrote a whole
CHANGELOG that way, and a reader could not tell from any release name what was in it:

| Was | Means | Should have said |
|---|---|---|
| "a release can carry docs" | a maintenance release | "maintenance" |
| "a rendered file goes straight into a Live clip" | you can now bounce audio into a clip slot | "put a rendered file straight into a Live clip" |
| "two dials that were not what they seemed" | two bug fixes about parameter ranges | "where files went, and two dials that were not what they seemed" |
| "declarations that persist" | windows and saved state | "declarations that persist, and samples" |

Rules:

- **Say what the thing IS before you say anything clever about it.** A release note opens
  with what the release is FOR, in one line, in the words a user would use. "Two features
  and one example" beats any metaphor.
- **A maintenance release says "maintenance".** Do not dress up a version bump.
- **Name the feature, not the insight behind it.** The reader wants "you can now program
  the Push's 64 pads", not "the pads as a surface you program".
- **No teasing.** Nothing that only makes sense after the reader has read the thing it is
  labelling.

This applies to release names, headings, the first sentence of a section, and PR titles.

**Keep every technical word that is a name.** `parameter_enable`, `[live.observer]`,
`decodeAudioData`, `canonical_parent` and `ctx.appIn` are not jargon to be simplified -
they are what the thing is called, and a reader who cannot search for them cannot use
the document. Simplify the sentence around them.

**Facts and numbers do not get softened.** "2.6 ms per full frame", "176 control names",
"y counts from the TOP" - the whole value of `doc/MAX-FACTS.md` is that it is exact.
Plain language means saying it in fewer, simpler words, not saying less.

Code comments follow the same spirit but are not covered by this rule: they explain
mechanism to somebody reading the code, and they may be as long as the mechanism needs.


### Say why, not only what

**Every entry says what it is FOR.** What changed is in the diff. Why it was worth doing
is not, and that is the half a reader cannot reconstruct. This applies to PR summaries,
to every `.md` in the repo, and to code comments.

A heading names the payoff, not the plumbing. These were all real, and all rewritten by
hand afterwards because the first version said what moved rather than what it bought:

| Was | Should be |
|---|---|
| "the library comes from npm, not from a path on one machine" | "built from latest m4l-jweb v1.6.1 so we have options to map Strudel sliders and actions to the Push control surface" |
| "`open_url` was defined twice, and the build stopped" | "`open_url` moved upstream so we drop it" |
| "the installer in the ZIP said 'No .amxd found' on a good download" | "fixed the installer included in the ZIP - 'No .amxd found'" |
| "1.4.0, and the release zip is named after its version" | "release zips are now named after their version" |

The rules behind those:

- **Lead with the reason where the reason is the point.** "This was needed during
  investigation on macOS where the device view was not fitting, so each device now posts a
  diagnostics block" beats the same sentence with the reason moved to the end or dropped.
- **Write as the team. "We" is correct**, not a lapse: "so we drop it", "so we can try to
  explain the layout issues". The impersonal voice reads like a changelog generator.
- **Ordinary verbs are fine.** "Fixed the installer" needs no improving. Reaching for a
  crafted phrase is how a summary starts sounding written rather than reported.
- **A purpose clause beats a second sentence of mechanism.** "to easily identify what's
  what" earns its words; a paragraph on how the zip is named does not.
- **Say it as honestly as you know it.** If a change is an investigation aid and not a
  fix, say so - "so we can try to explain the layout issues", not "which makes the layout
  question answerable". Do not promote a lead into a conclusion.
- **One dense paragraph beats two tidy ones.** Two paragraphs on the same subject are one
  paragraph and a paragraph break.

Also cut, beyond the list above: **error codes and internal proof.** `TS2393`, which
packages the lockfile resolved and at what version, "CI proves it from a clean checkout".
The reviewer has the diff and the checks. Naming an error code is only useful when the
reader would search for it.


### Comments

Comments say what the code cannot: the constraint, the trap, the thing that was measured
in Live and cost a day. Not what the next line does. They may be as long as the mechanism
needs.

Never use a cliche formula like "this is the trap that cost us a day". State the point and
stop.

### Commit messages

**Commit messages are not for literature. For that we have the markdown.**

ONE LINE. `type: what changed`, stated plainly. No body.

    feat: open external links in default browser
    fix: release a dial when its slider is deleted
    docs: clarify launchbrowser URL behavior
    chore: remove orphaned Studio windows and update TODO

No scope suffix by default (`feat:`, not `feat(strudel):`). The subject STATES, it does
not argue: "remove orphaned Studio windows", not "drop the orphaned Studio windows,
because nothing could open them any more".

Everything you were about to put in the body already has a home: the constraint goes in a
comment at that line, the measurement in `doc/MAX-FACTS.md` or `doc/ARCHITECTURE.md`, the
dead end in the drawer of failed ideas, the remaining work in `doc/TODO.md`, and the case
for the change in the PR summary. A commit says what changed; the repo says why.

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

`m4l-jweb` is the library and this is its consumer. It comes from npm (`^1.6.1` in
`package.json`), so this repo builds without a checkout of the library beside it and an
edit upstream reaches here only once it is published. To work on both at once, switch the
three `@m4l-jweb/*` deps to `link:../m4l-jweb/packages/*` locally - and switch them back
before opening a PR, because a path on one machine is not a dependency.

Anything general - patcher codegen, the Surface, window primitives, the wrapper
protocol - belongs UPSTREAM in `m4l-jweb`, not here. Anything about these
particular devices belongs here. When in doubt, ask whether another device repo
would want it.
