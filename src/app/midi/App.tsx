import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { isBareMini } from "@/lib/strudelCode";
import { useNativePanel, useParam, useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { PatternEditor } from "../shared/PatternEditor";
import { AboutPanel } from "../shared/AboutPanel";
import { ClipButton, ControlsButton, RunButton } from "../shared/DeviceButtons";
import { ClipPanel } from "../shared/ClipPanel";
import { HelpButton } from "../shared/HelpButton";
import { tokenAtCaret } from "@/lib/reference";
import { scaleLabel, useStrudel } from "./useStrudel";
import surface from "./surface";

/**
 * Gugelhupf MIDI - a MIDI effect. Sits on a MIDI track, before an instrument,
 * and streams live MIDI generated from a Strudel pattern.
 *
 * Live's device view is a FIXED ~169px tall - every row here is budgeted.
 * Layout: header (14) + editor (flex, min 48) + controls (22) + one button
 * row (30) + footer (14) + gaps/padding ~= 160px. Never add a row without
 * removing one.
 */
export default function App() {
	const s = useStrudel();
	// Full Strudel code is real JavaScript: the local parser errors and note
	// counter only apply to bare mini-notation. Both dialects export to a clip -
	// the Strudel engine renders it either way.
	const codeMode = !isBareMini(s.text);
	const scale = scaleLabel(s.scale);

	const [showAbout, setShowAbout] = useState(false);
	const [showClip, setShowClip] = useState(false);

	// THE TRANSPORT PANEL. `transport` is a native view-switch (surface.ts): on shows the
	// native panel that holds the macro-mappable Play/Stop parameter, off shows this
	// editor. Layered, not side-by-side (runtime reposition of native objects does not
	// work in a frozen M4L device), so the app hides one and shows the other - exactly the
	// FX device's knob-panel mechanism. The panel exists so a Rack macro has a visible
	// control to map to; the parameter is invisible, and so unmappable, without it.
	const [showTransport, setShowTransport] = useParam(surface, "transport");
	const applyPanel = useNativePanel(surface);
	useEffect(() => {
		applyPanel(showTransport ? "native" : "web");
	}, [showTransport, applyPanel]);

	const helpWindow = useWindow(surface, "help");
	// The floating reference follows the caret. It is a different Chromium context, so a
	// state slot is the only way to tell it what you are typing about.
	const [, setHelpQuery] = useStateSync(surface, "helpQuery");
	const strudelWindow = useWindow(surface, "strudel");

	if (showAbout) {
		return (
			<AboutPanel
				amxdBuild={s.amxdBuild}
				onOpenStrudel={strudelWindow.open}
				// Reveal the native panel (the mappable Play/Stop). It replaces the web UI, and
				// its own native Back switch returns - so close About on the way in.
				onClose={() => setShowAbout(false)}
			/>
		);
	}

	if (showClip) {
		return (
			<ClipPanel
				beatsPerCycle={s.beatsPerCycle} setBeatsPerCycle={s.setBeatsPerCycle}
				bpcAuto={s.bpcAuto} resetBeatsPerCycle={s.resetBeatsPerCycle}
				beatsPerBar={s.beatsPerBar} setBeatsPerBar={s.setBeatsPerBar}
				grid={s.grid} setGrid={s.setGrid}
				toMidi={s.toMidi} fromMidi={s.fromMidi}
				clipAvailable={s.clipAvailable}
				clipSupported={s.clipSupported}
				onClose={() => setShowClip(false)}
			/>
		);
	}

	return (
		<div className="device flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
			{/* TOP BAR: title + the primary buttons - ICON ONLY, the same chips the Strudel
			    device draws. The labels ("Run", "Clip") cost a third of the bar for words the
			    icons already say, and the tooltips still carry the full sentence. The pattern
			    options (octave, shift, scale) live in the small bottom row - they are set once,
			    not reached for while playing. Studio stays in About. */}
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>
					Strudel MIDI
				</button>
				<RunButton className="ml-auto" live={s.live} onRun={s.run} onStop={s.hush} />
				<ClipButton onOpen={() => setShowClip(true)} />
				<ControlsButton
					onShow={() => setShowTransport(true)}
					title="Controls: the native panel with the mappable Play/Stop. Its Back switch returns."
				/>
				<HelpButton onOpen={helpWindow.open} />
			</div>

			<PatternEditor
				value={s.text}
				onChange={s.setText}
				onCaret={(caret) => setHelpQuery(tokenAtCaret(s.text, caret))}
				onRun={s.run}
				spans={s.playing}
				invalid={Boolean(s.evalError || (!codeMode && s.errors.length > 0))}
			/>

			{(s.evalError || (!codeMode && s.errors.length > 0)) && (
				<span className="truncate text-[10px] leading-none text-destructive">
					{s.evalError ?? `${s.errors[0].msg} (at ${s.errors[0].pos})`}
				</span>
			)}

			{s.warning && (
				<span className="truncate text-[10px] leading-none text-amber-500" title={s.warning}>
					{s.warning}
				</span>
			)}

			{/* BOTTOM ROW: the pattern options at a small size, then status. */}
			<div className="flex items-center gap-1.5 text-[10px] leading-none text-muted-foreground">
				<select
					value={s.conv}
					onChange={(e) => s.setConv(e.target.value as "strudel" | "scientific")}
					className="rounded bg-input/50 px-1 py-0.5 outline-none"
					title="Which octave is middle C - the two DAW conventions differ"
				>
					<option value="strudel">c5=60</option>
					<option value="scientific">c4=60</option>
				</select>
				<label className="flex items-center gap-0.5">
					Shift
					<input
						type="number"
						min={-4}
						max={4}
						value={s.octaveOffset}
						onChange={(e) => s.setOctaveOffset(Number(e.target.value))}
						className="w-8 rounded bg-input/50 px-1 py-0.5 outline-none"
					/>
				</label>
				<label
					className="flex items-center gap-1"
					title="Read bare numbers as degrees of Live's global scale. Off: a number is a raw MIDI pitch."
				>
					<input
						type="checkbox"
						checked={s.liveScale}
						onChange={(e) => s.setLiveScale(e.target.checked)}
						className="size-3 accent-primary"
					/>
					Scale
				</label>
				<span
					className={cn("truncate", !scale.known && "text-destructive")}
					title={
						scale.known
							? "Live's global scale - bare numbers in the pattern are degrees of it"
							: `Live's scale "${s.scale.name}" is not one this device knows - degrees fall back to Major`
					}
				>
					{scale.text}
				</span>
				<span className="shrink-0">{codeMode ? "code" : `${s.noteCount} notes`}</span>
				<span className="ml-auto truncate" title={s.status}>{s.status}</span>
				<span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">{s.debug}</span>
			</div>
		</div>
	);
}
