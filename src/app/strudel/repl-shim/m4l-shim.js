/**
 * m4l-shim.js - the ONLY thing this repo adds to the stock strudel.cc page.
 *
 * scripts/build-repl.mjs injects it into the built site with a <script> tag. The
 * submodule is never patched: the app stays the app, with its own engine, its own
 * scheduler and all its visualisers, and this file drives it from outside through
 * two globals that already exist -
 *
 *   window.max            injected by jweb into every page it loads (bindInlet/outlet)
 *   window.strudelMirror  the StrudelMirror editor (website/src/repl/useReplContext.jsx)
 *
 * It is plain ES5-ish JavaScript with no imports on purpose: it is copied into a
 * built site, not bundled with it, so it can depend on nothing but the page.
 *
 * WHAT IT DOES, and why each one is not optional:
 *
 *   1. ARMS THE AUDIO. The REPL waits for a `mousedown` on the document before it
 *      creates an AudioContext (initAudioOnFirstClick, superdough.mjs). A window
 *      that loads hidden at device load never gets one, so the device would be
 *      silent until the user opened the Studio and clicked in it.
 *
 *   2. PINS THE OUTPUT DEVICE. `initAudio({ audioDeviceName })` calls `setSinkId`
 *      for any device that is not the default - which would steer the sound to a
 *      sound card and AWAY from the [jweb~] outlets that are the track. A setting
 *      left over from a browser session would silently take the device off the
 *      track, so the saved value is forced back to the default.
 *
 *   3. PERSISTS THE PATTERN into the device's `code` state slot, so it saves with
 *      the LIVE SET rather than in this page's localStorage. The Live set is what
 *      a musician backs up, moves between machines and expects to reopen intact.
 *
 *   4. TAKES PLAY/STOP AND THE KNOBS from the device view, which is where Live's
 *      transport, Push and the automation lanes reach.
 */
(function () {
	"use strict";

	var TAG = "[m4l-shim]";
	var SETTINGS_PREFIX = "strudel-settings"; // website/src/settings.mjs, nanostores persistentMap
	var DEFAULT_DEVICE = "System Standard"; // superdough.mjs DEFAULT_AUDIO_DEVICE_NAME
	var LOADING = "// LOADING"; // the REPL's placeholder buffer while it boots

	/* -------------------------------------------------------------- *
	 * 2. The output device, BEFORE the app reads its settings.
	 * -------------------------------------------------------------- */
	try {
		// A persistentMap stores one localStorage entry per key, prefixed.
		localStorage.setItem(SETTINGS_PREFIX + "audioDeviceName", DEFAULT_DEVICE);
	} catch (e) {
		// Never let this file be the reason a page fails to load.
		console.warn(TAG, "could not pin the audio device:", e && e.message);
	}

	var max = null; // set once jweb has injected it
	var editor = null;
	var lastSentCode = null;
	var knobs = [0, 0, 0, 0, 0, 0, 0, 0];

	/** The current position of dial n (1..8), 0..1. A plain number, read once. */
	function knobValue(n) {
		var v = knobs[(n | 0) - 1];
		return typeof v === "number" ? v : 0;
	}

	/**
	 * The eight native dials, for a pattern to read: `m4lKnob(1)`..`m4lKnob(8)`.
	 *
	 * IT RETURNS A SIGNAL, NOT A NUMBER, and that is the whole point.
	 *
	 * A pattern is evaluated once and then plays for as long as you leave it. So a
	 * plain number is read at EVALUATION time and frozen there - `.lpf(200 +
	 * m4lKnob(1) * 2000)` sounds right, and then the knob does nothing until you
	 * evaluate again. That is not a knob, it is a default.
	 *
	 * A signal is queried by the scheduler every cycle instead, so the value is read
	 * WHILE THE PATTERN PLAYS and the dial moves the sound under your hand.
	 *
	 *     note("c3 e3 g3").s("sawtooth").lpf(m4lKnob(1).range(200, 2200))
	 *
	 * A dial can also DESCRIBE ITSELF, which is what the surface declarations do for
	 * every other parameter in this repo - a name, a unit, a range:
	 *
	 *     m4lKnob(1, { name: 'cutoff', unit: 'Hz', range: [200, 2200] })
	 *     m4lKnob(2, { name: 'room' })
	 *
	 * Single quotes there are not a style choice, though double ones are handled
	 * too: in the REPL a DOUBLE-quoted string is mini notation, rewritten into a
	 * pattern before the code runs, so `name: "cutoff"` arrives as an object. See
	 * asText().
	 *
	 * All of it optional, and `range` here is the same range `.range()` applies -
	 * given here, the returned signal is already scaled, so it reads once rather
	 * than twice. Name, unit and range are sent through the library's own parameter
	 * vocabulary (`param_label` / `param_unit` / `param_range`), which is what renames
	 * and re-ranges a native dial.
	 *
	 * KNOWN LIMIT, measured before this branch (doc/TODO.md item 5): the rename
	 * takes on the DEVICE PANEL but does NOT reach Live's parameter registry or the
	 * Rack macro picker, which keep showing S1..S8 - a frozen device cannot rename a
	 * parameter there. The unit is carried for the same reason: so that when a route
	 * to Live's own naming exists, the pattern is already saying what it means.
	 *
	 * `signal` reaches globalThis when the REPL loads its modules (evalScope in
	 * @strudel/core), which is after this file runs - hence the lookup at call time.
	 * Before it exists, the number is the honest fallback.
	 *
	 * `m4lKnobValue(n)` is the raw number, for a pattern that genuinely wants the
	 * value frozen at evaluation.
	 */
	window.m4lKnob = function (n, opts) {
		var index = (n | 0) - 1;
		var o = opts || {};
		describeKnob(index, o);

		var range = o.range;
		var lo = range ? Number(range[0]) : 0;
		var hi = range ? Number(range[1]) : 1;
		var read = range
			? function () {
					// SCALED HERE ONLY IF THE DIAL ITSELF IS NOT SCALED. The device tries
					// to give the dial the pattern's real travel, and says whether Live
					// accepted it (knobIsReal below). When it did, the value already
					// arrives in real units and scaling it again would square the range.
					return knobIsReal[index] ? knobValue(n) : lo + knobValue(n) * (hi - lo);
				}
			: function () {
					return knobValue(n);
				};

		var signal = globalThis.signal;
		return typeof signal === "function" ? signal(read) : read();
	};
	window.m4lKnobValue = knobValue;

	/**
	 * Tell the device what this dial IS, so the native knob can carry the name.
	 *
	 * Sent on change only. A pattern is re-evaluated constantly while it is being
	 * worked on, and `knob_label` writes a Live parameter attribute - resending an
	 * unchanged name on every keystroke is work for nothing.
	 */
	/**
	 * The text of something the REPL may have turned into a PATTERN.
	 *
	 * In the REPL every DOUBLE-quoted string is mini notation: the transpiler
	 * rewrites `"cutoff"` into a pattern before the code ever runs, so a name passed
	 * that way arrives as an object and `String()` of it is "[object Object]" - which
	 * is exactly what landed on the dial. Single quotes stay plain strings.
	 *
	 * Rather than making the caller remember which quote to use, take either: a
	 * pattern is asked for its first value.
	 */
	function asText(v) {
		if (v === null || v === undefined) return "";
		if (typeof v === "string") return v;
		if (typeof v === "number") return String(v);
		try {
			if (typeof v.queryArc === "function") {
				var haps = v.queryArc(0, 1);
				if (haps && haps.length) return String(haps[0].value);
			}
		} catch (e) {
			/* not a pattern, or an empty one - fall through */
		}
		return String(v);
	}

	/**
	 * Which dials Live agreed to give the pattern's own travel to.
	 *
	 * A dial is declared 0..1 at build time, so `slider(500, 100, 1000)` shows 0.44
	 * on the panel and on Push - honest about the knob, useless about the sound. The
	 * device tries to widen it to the declared range and answers whether that took;
	 * until the answer arrives, the value is 0..1 and the shim scales it.
	 */
	/* -------------------------------------------------------------- *
	 * 5. THE PATTERN'S OWN slider() CALLS, on the device's dials.
	 *
	 * `m4lKnob()` is ours, and asking a Strudel coder to learn it just to reach a
	 * Live knob is a tax on the wrong person. `slider()` is what they already write,
	 * and everything needed to adopt it is public already:
	 *
	 *   READ  - after each evaluation `strudelMirror.widgets` holds every slider as
	 *           { id, from, to, value, min, max, step }, `id` being the character
	 *           range of the first argument and ascending `from` being source order.
	 *   WRITE - `window.postMessage({ type: 'cm-slider', id, value })` sets
	 *           `sliderValues[id]`, which the pattern's `ref()` reads on its next
	 *           query. The inline widget posts exactly this when dragged.
	 *
	 * WHAT A DIAL DELIBERATELY DOES NOT DO: dragging the inline slider also REWRITES
	 * THE CODE TEXT (`view.dispatch({ changes })`). A Live dial does not, because
	 * automation moves it dozens of times a second and rewriting the document at that
	 * rate would fight the typing and keep the set permanently dirty. So the sound
	 * follows the dial while the number in the code stays as written - it is the
	 * DECLARED value. The widget's thumb is nudged directly in the DOM, which costs
	 * nothing and stops the page looking frozen.
	 *
	 * NAMES AND UNITS. `slider(500, 100, 1000, 1, { name: 'cutoff', unit: 'Hz' })`
	 * already runs in stock strudel - the transpiler reads the first four arguments
	 * and `sliderWithID` ignores the rest - but the options are DROPPED, so they
	 * cannot be read back from the widget. Until upstream carries them through
	 * (doc/FEAT-SLIDERS.md), they are parsed out of the code here. The parse fails
	 * soft: no name is a fine outcome, and the slider still lands on a dial with its
	 * real range.
	 * -------------------------------------------------------------- */

	/** How long the first argument is, so its end offset can be computed. */
	function firstArgLength(args) {
		var depth = 0;
		for (var i = 0; i < args.length; i++) {
			var c = args[i];
			if (c === "(" || c === "[" || c === "{") depth++;
			else if (c === ")" || c === "]" || c === "}") depth--;
			else if (c === "," && depth === 0) return i;
		}
		return args.length;
	}

	/**
	 * The options object of each `slider()` call, filed under the END OFFSET of its
	 * first argument - which is what the transpiler builds the widget's id from, and
	 * therefore the only thing that ties the two together.
	 */
	function parseSliderOptions(code) {
		var found = {};
		if (typeof code !== "string") return found;
		var re = /\bslider\s*\(/g;
		var m;
		while ((m = re.exec(code)) !== null) {
			var open = m.index + m[0].length - 1;
			var depth = 0;
			var end = -1;
			for (var i = open; i < code.length; i++) {
				if (code[i] === "(") depth++;
				else if (code[i] === ")" && --depth === 0) {
					end = i;
					break;
				}
			}
			if (end < 0) continue; // half-typed code: leave it alone
			var args = code.slice(open + 1, end);
			var brace = args.indexOf("{");
			if (brace < 0) continue;
			var obj = args.slice(brace);
			var opts = {};
			var name = /name\s*:\s*['"]([^'"]*)['"]/.exec(obj);
			var unit = /unit\s*:\s*['"]([^'"]*)['"]/.exec(obj);
			var order = /order\s*:\s*(-?\d+)/.exec(obj);
			if (name) opts.name = name[1];
			if (unit) opts.unit = unit[1];
			if (order) opts.order = Number(order[1]);
			if (opts.name || opts.unit || opts.order !== undefined) {
				found[open + 1 + firstArgLength(args)] = opts;
			}
		}
		return found;
	}

	/**
	 * The name a bare `slider()` should carry: the METHOD it is an argument to.
	 *
	 * `.lpf(slider(600, 200, 2000))` is a cutoff, and the user already said so by
	 * writing `lpf` - asking them to repeat it in an options object to get a dial that
	 * is not called "slider 1" is asking twice. Only `m4lKnob({ name })` used to
	 * produce a real name, so every plain slider reached Live anonymous.
	 *
	 * Looked up BACKWARDS from this widget's own source offset, not by scanning the
	 * file forwards: the widgets are re-ordered by `order`, and a forward scan pairs
	 * the Nth method with the Nth slot rather than with its own slider. `[^()]*$`
	 * requires the argument list to still be open at the widget, so `.s("sawtooth")`
	 * before an unrelated slider does not claim it.
	 */
	function methodNameFor(code, w) {
		if (typeof code !== "string" || !w || typeof w.from !== "number") return "";
		var before = code.slice(0, w.from);
		// The widget's offset points at the slider's FIRST ARGUMENT, so `slider(` is
		// normally still open in front of it - and its paren would stop the scan below
		// before it reached the method. Drop that call first; the method is then
		// whatever call is still open, `.lpf(` or `.lpf(200, `.
		before = before.replace(/\bslider\s*\(\s*[^()]*$/, "");
		var m = /\.([A-Za-z_$][\w$]*)\s*\(\s*[^()]*$/.exec(before);
		return m ? m[1] : "";
	}

	/** Slot index -> the slider it is carrying. */
	var sliderMap = [];
	var lastSliderKey = "";

	function syncSliders() {
		if (!editor || !max) return;
		var widgets = editor.widgets || [];
		var sliders = [];
		for (var i = 0; i < widgets.length; i++) {
			if (widgets[i] && widgets[i].type === "slider") sliders.push(widgets[i]);
		}
		sliders.sort(function (a, b) {
			return a.from - b.from;
		});

		var opts = parseSliderOptions(editor.code);
		// `order` only ever OVERRIDES source order, which the sort above already is.
		var ordered = sliders.slice().sort(function (a, b) {
			var ao = (opts[a.to] || {}).order;
			var bo = (opts[b.to] || {}).order;
			if (ao === undefined && bo === undefined) return sliders.indexOf(a) - sliders.indexOf(b);
			if (ao === undefined) return 1;
			if (bo === undefined) return -1;
			return ao - bo;
		});

		// Describing a dial writes Live parameter attributes, so only do it when the
		// pattern's controls actually changed - not on every evaluation.
		var key = ordered
			.map(function (w) {
				var o = opts[w.to] || {};
				// The inferred name is part of the key: moving a slider from `.lpf(...)`
				// to `.room(...)` changes nothing else about the widget, and without this
				// the dial keeps the old method's name.
				return w.id + ":" + w.min + ":" + w.max + ":" + (o.name || methodNameFor(editor.code, w)) + ":" + (o.unit || "");
			})
			.join("|");
		if (key === lastSliderKey) return;
		lastSliderKey = key;

		var previouslyOwned = sliderMap.slice();
		sliderMap = [];
		for (var n = 0; n < 8; n++) {
			var w = ordered[n];
			var param = "s" + (n + 1);
			if (!w) {
				sliderMap[n] = null;
				// A slot this pattern no longer uses has to be RELEASED, or the fader
				// of a slider that was deleted stays on screen driving nothing. Only
				// slots a slider held are cleared: a dial described by m4lKnob() is
				// not ours to reset.
				if (previouslyOwned[n]) {
					max.outlet("param_label", param, "S" + (n + 1));
					max.outlet("slider_range", param, 0, 1);
					max.outlet("slider_clear", param);
				}
				continue;
			}
			var o = opts[w.to] || {};
			sliderMap[n] = { id: w.id, min: Number(w.min), max: Number(w.max) };
			// An explicit `m4lKnob({ name })` wins; otherwise the wrapping method is the
			// name; "slider N" is the last resort, for a slider that is not an argument
			// to anything.
			max.outlet("param_label", param, o.name || methodNameFor(editor.code, w) || "slider " + (n + 1));
			if (o.unit) {
				max.outlet("param_unit", param, o.unit);
				max.outlet("slider_unit", param, o.unit);
			}
			// NOT `param_range`. Widening a dial's travel at runtime takes, and then the
			// dial stops following its automation lane and any Rack macro mapped to it -
			// both keep writing the build-time 0..1 domain, so the value pins at the
			// bottom and the knob never moves. The dial stays 0..1 and the range travels
			// to the device view instead, which scales.
			if (w.max > w.min) max.outlet("slider_range", param, Number(w.min), Number(w.max));
			// The dial should start where the CODE says rather than wherever it was
			// left by the last pattern. A window cannot write a Live parameter, so the
			// device page does it (forwarded by wrapper/device.ts).
			max.outlet("slider_seed", param, Number(w.value));
		}
	}

	/** Move a slider from a dial, and nudge its widget so the page keeps up. */
	function setSlider(index, value) {
		var slot = sliderMap[index];
		if (!slot) return;
		window.postMessage({ type: "cm-slider", id: slot.id, value: value });
		try {
			var el = document.getElementById(slot.id);
			if (el) el.value = value;
		} catch (e) {
			/* cosmetic only - the sound has already changed */
		}
	}

	var knobIsReal = [];

	/** `s3` -> 2. The library answers by parameter id; the dials are a pool. */
	function knobIndexOf(id) {
		return Number(String(id).replace(/^s/, "")) - 1;
	}

	var knobDescriptions = [];
	function describeKnob(index, o) {
		if (index < 0 || index > 7) return;
		var name = asText(o.name || o.label);
		if (!name) return;
		// The unit is NOT part of the name. A dial is a few characters wide and Live
		// has its own place for a unit - it is what makes the readout say "600 Hz"
		// instead of "600". Two messages, so the device can put each where it goes.
		var unit = asText(o.unit);
		var range = o.range;
		var lo = range ? Number(range[0]) : null;
		var hi = range ? Number(range[1]) : null;

		var key = name + " " + unit + " " + lo + " " + hi;
		if (knobDescriptions[index] === key) return;
		knobDescriptions[index] = key;
		if (!max) return;
		// The LIBRARY's vocabulary, keyed by the parameter's own id - the same
		// messages any device's page uses to say what a control now is
		// (describeParam in @m4l-jweb/bridge).
		var param = "s" + (index + 1);
		max.outlet("param_label", param, name);
		if (unit) {
			max.outlet("param_unit", param, unit);
			// ...and to the device page, which draws the unit under its own fader.
			// The library's param_unit reaches LIVE (the readout on the dial) and is
			// not echoed back to any page - see wrapper/device.ts.
			max.outlet("slider_unit", param, unit);
		}
		// The travel goes to the device view, NOT onto the Live dial. Widening a dial
		// at runtime costs it its automation lane and its macro mapping (see
		// syncSliders), which is more than a nicer readout is worth. The page scales.
		if (range && hi > lo) max.outlet("slider_range", param, lo, hi);
	}

	function ready(fn) {
		var tries = 0;
		var poll = setInterval(function () {
			tries += 1;
			if (window.max && window.strudelMirror) {
				clearInterval(poll);
				fn(window.strudelMirror, window.max);
			} else if (tries > 300) {
				clearInterval(poll);
				console.warn(TAG, "gave up waiting for", window.max ? "the REPL" : "window.max");
			}
		}, 100);
	}

	ready(function (mirror, m) {
		editor = mirror;
		max = m;

		/* ------------------------------------------------------------ *
		 * 1. Arm the audio with no click.
		 * ------------------------------------------------------------ */
		try {
			document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		} catch (e) {
			console.warn(TAG, "could not arm the audio:", e && e.message);
		}

		/* ------------------------------------------------------------ *
		 * 3. The pattern, from and to the Live set.
		 *
		 * The REPL loads its own last buffer asynchronously (initCode, from the URL
		 * hash or its localStorage), so writing ours immediately would be overwritten
		 * a moment later. Wait until its own load has settled - the buffer stops
		 * being the "// LOADING" placeholder - and only then apply the set's pattern.
		 * ------------------------------------------------------------ */
		var restored = false;
		var pending = null;

		function applyRestore() {
			if (restored || pending === null) return;
			if (!editor.code || editor.code.indexOf(LOADING) === 0) return; // still booting
			restored = true;
			if (pending.length && pending !== editor.code) {
				editor.setCode(pending);
				console.log(TAG, "restored the pattern from the Live set");
			}
			lastSentCode = editor.code;
		}

		max.bindInlet("state_code", function (json) {
			try {
				var code = JSON.parse(json);
				if (typeof code !== "string") return;
				if (restored) {
					// A later write is another view editing the same slot (the mini
					// device, the old Studio). Follow it, unless it is our own echo.
					if (code !== editor.code) editor.setCode(code);
					lastSentCode = code;
					return;
				}
				pending = code;
				applyRestore();
			} catch (e) {
				console.warn(TAG, "bad code slot:", e && e.message);
			}
		});
		max.outlet("get_state", "code");

		/**
		 * Write the buffer back whenever it changes.
		 *
		 * A poll rather than a hook on `evaluate`, deliberately: the REPL has several
		 * paths that change the buffer (evaluate, its own pattern browser, a paste),
		 * and typing that has not been evaluated yet is still work the musician would
		 * expect to survive a save. One string comparison a second costs nothing.
		 */
		setInterval(function () {
			applyRestore(); // in case the REPL was still booting when the slot arrived
			// The widget list is rebuilt on every evaluation, and there is no event to
			// hang this off, so it rides the same poll as the code slot. syncSliders()
			// returns immediately unless the pattern's controls actually changed.
			try {
				syncSliders();
			} catch (e) {
				console.warn(TAG, "slider sync failed:", e && e.message);
			}
			if (!restored) return;
			var code = editor.code;
			if (typeof code !== "string" || code === lastSentCode) return;
			lastSentCode = code;
			try {
				max.outlet("sync_state", "code", JSON.stringify(code));
			} catch (e) {
				console.warn(TAG, "could not persist the pattern:", e && e.message);
			}
		}, 1000);

		/* ------------------------------------------------------------ *
		 * 4. Transport and knobs, forwarded by the device view.
		 * ------------------------------------------------------------ */
		max.bindInlet("set_play", function (v) {
			try {
				if (Number(v)) editor.evaluate();
				else editor.stop();
			} catch (e) {
				console.warn(TAG, "transport failed:", e && e.message);
			}
		});

		// Whether a dial now travels in the pattern's own units. Until this says so,
		// the value is 0..1 and m4lKnob scales it - exactly one scaling either way.
		max.bindInlet("param_range_ok", function (id) {
			knobIsReal[knobIndexOf(id)] = true;
		});
		max.bindInlet("param_range_failed", function (id) {
			knobIsReal[knobIndexOf(id)] = false;
		});

		// Say ONCE, in the REPL's own console, that the dials are arriving. Without it
		// a knob that does nothing is ambiguous: the value may not be reaching the
		// page at all, or it may be arriving and the pattern may have frozen it (see
		// m4lKnob above). This distinguishes the two without a debugger.
		var announced = false;
		for (var i = 1; i <= 8; i++) {
			(function (n) {
				max.bindInlet("set_s" + n, function (v) {
					knobs[n - 1] = Number(v) || 0;
					// A dial carrying one of the pattern's own slider() calls moves it.
					// m4lKnob() reads the same value from `knobs`, so both idioms work
					// off one dial without either knowing about the other.
					setSlider(n - 1, Number(v) || 0);
					if (announced) return;
					announced = true;
					var log = globalThis.logger;
					var msg = "m4l: the device's dials are live - use m4lKnob(1..8), e.g. .lpf(m4lKnob(1).range(200,2200))";
					if (typeof log === "function") log(msg);
					else console.log(TAG, msg);
				});
			})(i);
		}

		max.outlet("shim_ready", 1);
		console.log(TAG, "ready - pattern persists to the Live set, transport and knobs are live");
	});
})();
