import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useNativePanel, useParam, useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { PatternEditor } from "../shared/PatternEditor";
import { AboutPanel } from "../shared/AboutPanel";
import { Button } from "../shared/Button";
import { ControlsButton } from "../shared/DeviceButtons";
import { HelpButton } from "../shared/HelpButton";
import { SliderRow } from "../shared/SliderRow";
import { tokenAtCaret } from "@/lib/reference";
import { useSynth } from "./useSynth";
import surface from "./surface";

/**
 * Gugelhupf Synth - superdough as a plain MIDI instrument.
 *
 * Type a SOUND (`s("sawtooth").lpf(800).room(.3)` - a superdough value, not a pattern),
 * press Run, and every MIDI note the track sends plays it. No transport and no Play
 * button: the notes are the trigger, so a clip, a keyboard or another Strudel device in
 * front all drive it the same way.
 *
 * Same 169px budget as every device: header (14) + editor (flex) + slider row + status.
 */
export default function App() {
	const s = useSynth();
	const [showAbout, setShowAbout] = useState(false);

	const [showKnobs, setShowKnobs] = useParam(surface, "transport");
	const applyPanel = useNativePanel(surface);
	useEffect(() => {
		applyPanel(showKnobs ? "native" : "web");
	}, [showKnobs, applyPanel]);

	const helpWindow = useWindow(surface, "help");
	const [, setHelpQuery] = useStateSync(surface, "helpQuery");

	if (showAbout) {
		return (
			<AboutPanel
				amxdBuild={s.amxdBuild}
				onClose={() => setShowAbout(false)}
				debug={`${s.status}\n${s.debug}`}
			/>
		);
	}

	return (
		<div className="device flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>
					Strudel Synth
				</button>
				{/* NOT a transport button, and deliberately not drawn as one: this device has
				    nothing to start. The notes are Live's, so the only action here is "take the
				    sound I just typed" - a tick, not a play triangle. */}
				<Button
					className="ml-auto"
					icon={Check}
					onClick={s.run}
					title="Apply this sound (Ctrl+Enter). The notes come from the track's MIDI."
				/>
				<ControlsButton
					onShow={() => setShowKnobs(true)}
					title="Controls: the native panel with the eight slider knobs (S1..S8). Its Back switch returns."
				/>
				<HelpButton onOpen={helpWindow.open} />
			</div>

			<PatternEditor
				value={s.text}
				onChange={s.setText}
				onCaret={(caret) => setHelpQuery(tokenAtCaret(s.text, caret))}
				onRun={s.run}
				spans={[]}
				invalid={Boolean(s.error)}
			/>

			{s.error ? (
				<span className="truncate text-[10px] leading-none text-destructive" title={s.error}>
					{s.error}
				</span>
			) : (
				<span className="truncate text-[10px] leading-none text-muted-foreground" title={s.status}>
					{s.status}
				</span>
			)}

			{/* Every slider() in the spec, live, on a native knob (S1..S8). */}
			<SliderRow sliders={s.sliders} />
		</div>
	);
}
