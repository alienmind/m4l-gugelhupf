import { useState } from "react";
import { Drum, ChevronLeft, Maximize2, RotateCcw } from "lucide-react";
import { useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { isBareMini } from "@/lib/strudelCode";
import surface from "./surface";
import { DrumRack } from "./DrumRack";
import { PatternEditor } from "../shared/PatternEditor";
import { AboutPanel } from "../shared/AboutPanel";
import { Button } from "../shared/Button";
import { ClipButton, RunButton } from "../shared/DeviceButtons";
import { ClipPanel } from "../shared/ClipPanel";
import { HelpButton } from "../shared/HelpButton";
import { tokenAtCaret } from "@/lib/reference";
import { useStrudel } from "./useStrudel";

/**
 * Strudel MIDI - a MIDI effect. Sits on a MIDI track, before an instrument,
 * and streams live MIDI generated from a Strudel pattern.
 *
 * Live's device view is a FIXED ~169px tall - every row here is budgeted.
 * Layout: header (14) + editor (flex, min 48) + controls (22) + one button
 * row (30) + footer (14) + gaps/padding ~= 160px. Never add a row without
 * removing one.
 */
export default function App() {
	const s = useStrudel();
	const editorWindow = useWindow(surface, "editor");
	const helpWindow = useWindow(surface, "help");
	// The floating reference follows the caret. It is a different Chromium context, so a
	// state slot is the only way to tell it what you are typing about.
	const [, setHelpQuery] = useStateSync(surface, "helpQuery");
	const strudelWindow = useWindow(surface, "strudel");
	const [showDrums, setShowDrums] = useState(false);
	// The bottom-left note of the mini rack's 16-pad window (C1 = 36, like Live).
	const [drumBase, setDrumBase] = useState(36);
	const [showAbout, setShowAbout] = useState(false);
	const [showClip, setShowClip] = useState(false);
	
	// Full Strudel code is real JavaScript: the local parser errors and note
	// counter only apply to bare mini-notation. Both dialects export to a clip -
	// the Strudel engine renders it either way.
	const codeMode = !isBareMini(s.text);

	if (showAbout) {
		return <AboutPanel amxdBuild={s.amxdBuild} onOpenStrudel={strudelWindow.open} onClose={() => setShowAbout(false)} />;
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

	if (showDrums) {
		return (
			<div className="device flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
				<div className="flex items-center gap-2 leading-none pb-1 mb-1 border-b border-input">
					<button 
						onClick={() => setShowDrums(false)} 
						className="flex items-center justify-center p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
						title="Back to Sequencer"
					>
						<ChevronLeft className="size-4" />
					</button>
					<span className="text-xs font-semibold tracking-tight">Drum Rack</span>
					<div className="ml-auto flex items-center gap-1">
						<button
							onClick={s.resetDrumMap}
							className="flex items-center gap-1 rounded p-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Back to the General MIDI defaults"
						>
							<RotateCcw className="size-3" />
							Reset
						</button>
						<button
							onClick={() => editorWindow.open()}
							className="flex items-center gap-1 rounded p-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Open the drum rack in a larger floating window (C1 to C6)"
						>
							<Maximize2 className="size-3" />
							Expand
						</button>
					</div>
				</div>
				<DrumRack
					map={s.drumMap}
					onChange={s.setDrumMap}
					lowNote={drumBase}
					highNote={drumBase + 15}
					stripe={{ base: drumBase, setBase: setDrumBase, pageSize: 16 }}
				/>
			</div>
		);
	}

	return (
		<div className="device flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
			{/* TOP BAR: title + the primary buttons, grey and consistent with the other
			    devices. Octave/shift moved to the small bottom row; Studio moved to About. */}
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>
					Gugelhupf Drums MIDI
				</button>
				<RunButton className="ml-auto" live={s.live} onRun={s.run} onStop={s.hush} />
				<ClipButton onOpen={() => setShowClip(true)} />
				<Button icon={Drum} onClick={() => setShowDrums(true)} title="Kit: map drum words (bd, sd, hh) onto Drum Rack pads" />
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
				<span className="shrink-0">{codeMode ? "code" : `${s.noteCount} notes`}</span>
				<span className="ml-auto truncate" title={s.status}>{s.status}</span>
				<span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">{s.debug}</span>
			</div>
		</div>
	);
}
