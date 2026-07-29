import { useEffect, useRef } from "react";
import { sendToWindow } from "@m4l-jweb/bridge";
import { useParam } from "@m4l-jweb/surface/react";
import surface from "./surface";

/** The eight native dials, in the order the pool assigns them. */
const KNOB_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"] as const;

/**
 * Carry the device's LIVE-FACING controls into the REPL window.
 *
 * The Studio owns the engine, but Live's transport, Push, the automation lanes and
 * the Rack macros all reach the DEVICE, not a floating window: a parameter exists
 * in the patcher, and a knob turn is delivered to the device view's page and to
 * nothing else. So the device view is the only place that can hear a knob move, and
 * this hook is what passes it on.
 *
 * `sendToWindow` and not a state slot on purpose - a slot saves with the set, and a
 * knob being swept would write the Live set on every frame. The pattern persists
 * (that is a slot); a knob position in flight does not.
 *
 * The receiving end is `repl-shim/m4l-shim.js`, which turns `set_play` into
 * evaluate/stop and keeps `set_s1..s8` for the pattern to read as `m4lKnob(n)`.
 */
export function useReplRemote(
	/**
	 * Whether the Studio is the engine Live's transport drives. When it is not, the
	 * device's scratchpad is, and the Studio is held at stop - the two never sound
	 * together (app/strudel/transport.ts). The dials keep arriving either way: a knob
	 * is a control, not a transport, and a Studio pattern that is not playing yet
	 * should already be holding the values it will start with.
	 */
	transport = true,
): void {
	const [play] = useParam(surface, "play");
	/* eslint-disable react-hooks/rules-of-hooks */
	const knobs = KNOB_IDS.map((id) => useParam(surface, id)[0]);
	/* eslint-enable react-hooks/rules-of-hooks */

	// The window's page may not be listening yet when the device loads, and there is
	// no handshake back from it - so the first value of each control is sent again
	// once, shortly after mount, rather than being lost to a race.
	const sent = useRef<Record<string, number>>({});
	const send = (selector: string, value: number, force = false) => {
		if (!force && sent.current[selector] === value) return;
		sent.current[selector] = value;
		sendToWindow("repl", selector, value);
	};

	/** May a `play` that is already down start the Studio? Same latch, and the same
	 *  reason, as the device engine's - see useStrudelEngine. */
	const armed = useRef(true);

	useEffect(() => {
		if (!transport) {
			armed.current = false;
			send("set_play", 0);
			return;
		}
		if (!armed.current) {
			if (play) return;
			armed.current = true;
		}
		send("set_play", play ? 1 : 0);
	}, [transport, play]);

	useEffect(() => {
		knobs.forEach((value, i) => send(`set_${KNOB_IDS[i]}`, typeof value === "number" ? value : 0));
	}, knobs);

	useEffect(() => {
		const t = setTimeout(() => {
			// Whatever the latch above last decided - NOT the mount value, which was
			// decided before the Studio's own pattern had come back from the set.
			send("set_play", sent.current["set_play"] ?? 0, true);
			knobs.forEach((value, i) => send(`set_${KNOB_IDS[i]}`, typeof value === "number" ? value : 0, true));
		}, 3000);
		return () => clearTimeout(t);
		// Once, after the page has had time to load. Deliberately not re-run on value
		// changes - the effects above already cover those.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
