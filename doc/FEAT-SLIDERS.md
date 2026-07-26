# Feature: slider() metadata, and a Sliders pane

## Overview

Strudel's `slider(value, min, max, step)` renders an inline widget in CodeMirror. The
proposal is to let a slider optionally say what it IS - a name, a unit, a display order -
so that:

- strudel.cc can gather every slider of a pattern into one "Sliders" pane instead of
  making the user hunt for them inline;
- m4l-gugelhupf can map them onto Ableton's device knobs (`S1..Sn`) with the right label
  and range, and stop asking its users to write a bespoke `m4lKnob()` primitive.

The point is that a Strudel coder writes the Strudel they already know. Metadata is
optional; a plain `slider(0.5)` keeps working exactly as it does.

## 0. What already works, unchanged (checked against the submodule)

**The extra argument is already harmless.** Writing

```js
s("sawtooth").lpf(slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' }))
```

runs today, in stock strudel, with no patch at all. The path:

- `sliderTranspilerPlugin` (`packages/transpiler/plugin-widgets.mjs`) reads
  `arguments[0..3]` into its `sliderConfig` and ignores anything after them.
- `sliderWithLocation()` unshifts the range id and renames the callee, so the emitted
  call is `sliderWithID(id, value, min, max, step, {..})`.
- `sliderWithID = (id, value, min, max) => ...` (`packages/codemirror/slider.mjs`) takes
  four parameters and ignores the rest.

So the metadata is silently DROPPED, not rejected. That is the right failure: the same
pattern text plays identically with or without the upstream change.

**Reading the live sliders needs no change.** After each evaluation the editor holds
them: `window.strudelMirror.widgets.filter(w => w.type === 'slider')`, each
`{ id, from, to, value, min, max, step }`, where `id` is `"<from>:<to>"` - the character
range of the FIRST argument - and ascending `from` is source order.

**Writing a value needs no change either.** `slider.mjs` registers a `window` message
listener, so

```js
window.postMessage({ type: 'cm-slider', id, value })
```

updates `sliderValues[id]`, which is what the pattern's `ref()` reads on the next query.
That is the same channel the inline widget uses when dragged.

**What does NOT work without the upstream change:** the metadata never reaches
`sliderConfig`, so it cannot be read back from `editor.widgets`. Anyone wanting it today
has to parse it out of the code text (see section 4).

## 1. The upstream change: carry the options through

`slider(value, min, max, step, { name?, unit?, order? })`.

In `sliderTranspilerPlugin`, read a fifth `ObjectExpression` argument and fold its
literal properties into the emitted config:

```js
let options = {};
const optsNode = node.arguments[4];
if (optsNode?.type === 'ObjectExpression') {
  for (const p of optsNode.properties) {
    const key = p.key?.name ?? p.key?.value;
    if (key && p.value?.type === 'Literal') options[key] = p.value.value;
  }
}

const sliderConfig = {
  from, to, id,
  value: node.arguments[0].raw,
  min: node.arguments[1]?.value ?? 0,
  max: node.arguments[2]?.value ?? 1,
  step: node.arguments[3]?.value,
  type: 'slider',
  ...options,
};
```

Non-literal properties (a variable, a template string) are skipped rather than thrown on:
the transpiler runs on every keystroke and must never fail on half-typed code.

`packages/codemirror/slider.mjs` needs NO signature change for this to work. Its bare
`slider = (value) => ...` export is only the non-transpiled fallback (it warns and
returns `pure(value)`), and `sliderWithID` already ignores surplus arguments. Updating
the JSDoc to document the options argument is worth doing; changing the code is not
required.

`order` is an override, not the default: ascending `from` already gives source order.

## 2. The Sliders pane (strudel.cc)

1. Add `sliders: 'sliders'` to `tabNames` in
   `website/src/repl/components/panel/Panel.jsx`.
2. Read the active sliders from the editor (`strudelMirror.widgets`, filtered to
   `type === 'slider'`), or from the repl state, which carries `sliders` per code block
   (`packages/core/repl.mjs`).
3. New `SlidersTab.jsx`: sort by `order` then `from`, render `<input type="range">` with
   the `name` as label and the `unit` beside the value, and on input post the same
   `cm-slider` message the inline widget posts.

## 3. What m4l-gugelhupf does with it

**Correction to an earlier draft of this document:** the `update` CustomEvent on
`<strudel-editor>` belongs to `packages/repl` - the embeddable web component. The Studio
window loads the full website, not that component, so no such event is dispatched and
listening for it would wait forever. The seam here is `window.strudelMirror` directly,
which the m4l shim already uses for the code slot and transport.

So, in `src/app/strudel/repl-shim/m4l-shim.js`, after each evaluation:

- read `strudelMirror.widgets`, filtered to sliders, ordered by `from`;
- map the first eight onto `s1..s8` and call `describeParam(id, { name, unit, range })`
  for each - the library applies the name, the unit style and the travel, and answers
  whether the range took;
- on `set_s<n>` from Live, post `{ type: 'cm-slider', id, value }`.

That replaces `m4lKnob()` with the primitive Strudel users already know. `m4lKnob()`
stays for now and is deprecated once this lands - it costs nothing to keep and it is the
only thing that works against a stock, unpatched strudel.

## 4. Doing it locally, before the upstream change

Everything above works today EXCEPT reading the metadata, so the shim parses it out of
the code itself. Each slider config carries `to` - the end offset of the first argument -
so from there the shim scans forward to the call's closing parenthesis and takes a
trailing object literal if one is present. Small, contained, and it deletes itself the
day the transpiler carries the options: the shim prefers `w.name` when it is there and
falls back to the parse when it is not.

The parse is the only fragile part, so it fails soft - no name is a fine outcome, and the
slider still lands on a knob with its range.

## Files

Upstream:
- `packages/transpiler/plugin-widgets.mjs` - carry the options into `sliderConfig`
- `packages/codemirror/slider.mjs` - JSDoc only
- `website/src/repl/components/panel/Panel.jsx` + a new `SlidersTab.jsx`

Here:
- `src/app/strudel/repl-shim/m4l-shim.js` - read the sliders, describe the dials, write
  values back through `cm-slider`
