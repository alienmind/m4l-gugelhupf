/**
 * sliderLabels.test.ts - naming a dial after the method that wraps it.
 *
 * This is what is LEFT in this repo after 1.2.1 handed the knob pool to the library.
 * `useControls()` owns the borrowing, the range handshake and the seeding; the two
 * Strudel-specific halves that stayed are pushing values back into the pattern and
 * this - turning `.lpf(slider(600, 200, 2000))` into a dial the user sees as "lpf".
 *
 * It matters because `sliderWithID`'s id carries the source POSITION, not a name, so
 * there is nothing in the value itself to show anyone. The name is recovered from the
 * source text or it does not exist, and a wrong one is not an error - it is a knob
 * labelled after the wrong thing, on Push, mid-take.
 */
import { expect, test } from "vitest";
import { sliderLabels } from "../useSliderKnobs";

test("the wrapping method is the name", () => {
	const code = `note("c3 e3").s("sawtooth").lpf(slider(600, 200, 2000)).room(slider(.3))`;
	expect(sliderLabels(code, 2)).toEqual(["lpf", "room"]);
});

test("names come out in SOURCE order, which is the pool's mapping", () => {
	// Order is the whole binding - the first slider is S1 - so a scan that reordered
	// them would silently label every dial after its neighbour.
	const code = `s("bd").gain(slider(.8)).lpf(slider(400)).delay(slider(.2))`;
	expect(sliderLabels(code, 3)).toEqual(["gain", "lpf", "delay"]);
});

test("arguments before the slider do not hide the method", () => {
	const code = `note("c3").segment(4).range(slider(1), 8).lpf(200, slider(.5))`;
	expect(sliderLabels(code, 2)).toEqual(["range", "lpf"]);
});

test("a slider with no method around it still gets a name", () => {
	// A bare `slider()` - assigned to a variable, or the whole expression - has no
	// method to borrow from, and an unnamed fader is worse than a numbered one.
	expect(sliderLabels(`const x = slider(.5); note("c3").gain(x)`, 1)).toEqual(["slider 1"]);
});

test("count is what the ENGINE reported, not what the text looks like", () => {
	const code = `s("bd").gain(slider(.8))`;
	// Asking for more than the text names pads rather than truncating the pool: the
	// specs come from the compiled pattern, and the regex is only a naming heuristic
	// over the source. A short list here would leave a live dial with no label at all.
	expect(sliderLabels(code, 3)).toEqual(["gain", "slider 2", "slider 3"]);
	// And asking for fewer stops early rather than returning every match in the file.
	expect(sliderLabels(`.a(slider(1)).b(slider(2)).c(slider(3))`, 2)).toEqual(["a", "b"]);
});

test("no sliders, no labels", () => {
	expect(sliderLabels(`note("c3 e3").s("sawtooth")`, 0)).toEqual([]);
});
