/**
 * surface.ts (shared) - the parameters both MIDI devices declare.
 *
 * The PARAMS, not a Surface. Each device builds its own Surface from these, because
 * a device's own surface.ts is what the build reads to generate its live.* objects,
 * and the drums device now declares something the MIDI device does not: its drum map,
 * as state that travels with the Live set.
 *
 * DO NOT go back to sharing one Surface OBJECT between them. It compiles, and it
 * works - right up until the two devices' surfaces diverge, at which point a bundle
 * holds two Surfaces both declaring `play`, each with a store of its own, and the
 * bridge keeps exactly ONE handler per selector: the second `bindInlet("play")`
 * silently replaces the first, and a Play toggle stops following Live with no error
 * anywhere. One Surface per device, built from these.
 */
import { button, state } from "@m4l-jweb/surface";

/**
 * How many native dials the slider pool holds. Eight is Push's bank size.
 *
 * Here rather than next to either device's surface because three places have to agree
 * on it: the declaration (`knobPool(KNOB_POOL)`), the hook that lends the dials out,
 * and the device view that echoes the Studio's faders. The parameter ids follow from
 * it - `knobPool` names them `s1`..`s8` and `KNOB_IDS` spells the same list back.
 */
export const KNOB_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;
export const KNOB_POOL = KNOB_IDS.length;

/**
 * The transport control: play/stop, as a REAL Live parameter - automatable, and
 * macro-mappable so a Rack macro (or a Push button) can start and stop the sequencer.
 *
 * A `button` (live.text "Play/Stop"), not a `toggle`: same on/off value, but it carries
 * a visible label and reads as a button when it is drawn natively. It is invisible until
 * a surface places it in a `layout.native` (the midi device reveals it in a native panel
 * behind a switch, the way the FX device reveals its knobs) - a parameter with no
 * presentation rect cannot be clicked to map, which is why "hidden" made it unmappable.
 */
export const transportParams = {
	play: button({ default: false, label: "Play/Stop", short: "Play" }),
};

/**
 * THE PATTERN ITSELF - the code the user typed, as state that travels with the set.
 *
 * It is `state()` rather than component state for two reasons, and both are the point:
 *
 *   1. **It was not saved at all.** The text lived in `useState`, so it survived
 *      exactly as long as the page did: close the set, reopen it, and the pattern you
 *      wrote was the built-in default again. A parameter cannot hold it (Live only
 *      automates numbers), and `state()` is what the library built for precisely this.
 *   2. **A window is a different Chromium context.** The Full Studio window (R4-b) and
 *      the device view share no React state and can only reach each other through Max.
 *      One `[dict]` both bind is what makes them two views of ONE pattern rather than
 *      two editors racing; the library broadcasts every write to every open view.
 *
 * Not a parameter, deliberately: Live never looks inside it, it does not automate, and
 * it is not on Push - which is right for a block of source code.
 *
 * `initialText` still exists and still differs per device (each opens with its own
 * idiom), but it is now the slot's DEFAULT rather than the only value it ever had.
 */
export const codeSlot = (initialText: string) => state<string>({ default: initialText });

/**
 * WHAT THE CARET IS SITTING ON - the word the help window should be showing.
 *
 * The device view knows where the caret is; the help window is a different Chromium
 * context and can only be reached through Max. A `state()` slot is the ONLY channel
 * between the two (it is what `useStateSync` rides), so the device view writes the
 * token here on every keystroke and the help window reads it - which is what makes the
 * reference filter itself down to `.delay` as you type `.del`, IDE-style, in a separate
 * floating window.
 *
 * IT PERSISTS, and that is a small wart worth naming: this is a transient UI concern
 * and it will be saved with the set, because the library has no transient channel
 * between views. The cost is one meaningless word in the saved state; the alternative
 * is a new wrapper message type for something the state store already does.
 */
export const helpQuerySlot = () => state<string>({ default: "" });
