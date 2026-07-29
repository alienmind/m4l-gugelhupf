import { useEffect, useState } from "react";
import { Activity, ClipboardCopy, Code, SlidersVertical } from "lucide-react";
import { useNativePanel, useParam, useStateSync, useWindow } from "@m4l-jweb/surface/react";
import { PatternEditor } from "../shared/PatternEditor";
import { AboutPanel } from "../shared/AboutPanel";
import { Button } from "../shared/Button";
import { ControlsButton, ExportButton, RunButton } from "../shared/DeviceButtons";
import { HelpButton } from "../shared/HelpButton";
import { tokenAtCaret } from "@/lib/reference";
import { FaderBank } from "./FaderBank";
import { Visualizer } from "./Visualizer";
import { useReplKnobs } from "./useReplKnobs";
import { useReplRemote } from "./useReplRemote";
import { useStrudelRender } from "./useStrudelRender";
import { transportOwner } from "./transport";
import surface from "./surface";

/**
 * The device view's three faces. The VISUALIZER is the default because it answers
 * the question a device whose Studio window is shut cannot otherwise answer - is
 * this playing, and what is it doing.
 */
const VIEWS = [
	{ id: "visual", icon: Activity, title: "Visualizer: what the Studio is playing" },
	{ id: "knobs", icon: SlidersVertical, title: "Controls: the pattern's faders, full size" },
	{ id: "code", icon: Code, title: "Code: a scratchpad for seeing and controlling" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

/**
 * Strudel - THE device of this repo, and an instrument. Write ANY Strudel - multi-line `$:`, samples,
 * synths, orbits, superdough's real effects - and it becomes the track's audio: the
 * real superdough runs LIVE in this page and jweb~ routes its Web Audio output
 * straight into the track's signal path. Edits are audible immediately; there is no
 * render, no loop boundary to wait for, and a random pattern is simply random.
 *
 * EXPORT is the one place the offline renderer survives: it bounces the pattern to a
 * WAV next to the device (see useStrudelRender's exportAudio). The old
 * render-and-loop pipeline it descends from is parked in doc/DRAWER_OF_FAILED_IDEAS.md.
 *
 * Same 169px budget as every device: header (14) + editor (flex) + notice rows +
 * bottom status row.
 */
export default function App() {
	// BEFORE useStrudelRender, and that order is load-bearing: whether the Studio has
	// declared any faders decides whether this page's scratchpad is allowed to name the
	// S1..S8 dials. Two engines, one pool - see useSliderKnobs' `describe`.
	const { faders, declared } = useReplKnobs();
	/**
	 * ONE TRANSPORT, ONE ENGINE. Both pages sound into the same track, so `play`
	 * starting both meant the track carried the sum of the Studio's pattern and the
	 * scratchpad's. Whichever was started LAST holds it - see transport.ts.
	 */
	const [engineSlot, setEngineSlot] = useStateSync(surface, "engine");
	const owner = transportOwner(engineSlot);
	const s = useStrudelRender(!declared, owner === "scratchpad");
	const [play, setPlay] = useParam(surface, "play");

	/**
	 * Run, in the device view, is the SCRATCHPAD's - the Studio has its own. So it
	 * claims the transport first and starts second, in one event: the state store
	 * applies a write optimistically, so `s.run()` in the same handler already sees
	 * itself as the owner and does not stand down on the next render.
	 *
	 * An empty scratchpad claims NOTHING. Taking the transport away from a playing
	 * Studio to run silence is the worst outcome available here.
	 */
	const runScratchpad = () => {
		if (!s.text.trim()) return s.run(); // reports "nothing to run", changes no state
		setEngineSlot("scratchpad");
		s.run();
	};
	const [showAbout, setShowAbout] = useState(false);

	// The native transport panel behind the view switch - the MIDI device's mechanism.
	const [showTransport, setShowTransport] = useParam(surface, "transport");
	const applyPanel = useNativePanel(surface);
	useEffect(() => {
		applyPanel(showTransport ? "native" : "web");
	}, [showTransport, applyPanel]);

	const helpWindow = useWindow(surface, "help");
	const [, setHelpQuery] = useStateSync(surface, "helpQuery");
	/** THE Studio: the local strudel.cc, which owns the engine and the audio. */
	const replWindow = useWindow(surface, "repl");

	// CODE is the default: the device view is where a small pattern gets written, and
	// a device that opens on a meter looks like it is doing nothing.
	const [view, setView] = useState<ViewId>("code");
	/** Once the user picks a view by hand, stop moving it under them. */
	const [viewPinned, setViewPinned] = useState(false);

	// A fader appearing in the code means there is now something to GRAB, and
	// hunting for the view to grab it in is the friction this removes.
	useEffect(() => {
		if (declared && !viewPinned) setView("knobs");
	}, [declared, viewPinned]);

	/**
	 * Opening the Studio hands the writing over to it, so the device view stops being
	 * an editor and becomes the control surface for what the Studio is playing. It
	 * switches BEFORE the window opens, so it is already right when the user comes
	 * back to it.
	 */
	const openStudio = () => {
		setView("knobs");
		setViewPinned(true);
		replWindow.open();
	};
	// Live's transport and the eight native dials reach the DEVICE, never a floating
	// window - so the device view passes them on to the REPL's page.
	useReplRemote(owner === "studio");

	if (showAbout) {
		// RENDER HEALTH, debug-only
		const phase = s.status.phase === "idle" && !s.live ? "Ready - Run plays the pattern" : s.status.message;
		const debug =
			`${phase}\n` +
			`${s.status.phase}` +
			` / ${s.beatsPerCycle} beat${s.beatsPerCycle === 1 ? "" : "s"}/cyc` +
			` / bpm ${Math.round(s.tempo)} / ${s.playing ? "play" : "stop"} @ ${s.beats.toFixed(1)}`;
		return (
			<AboutPanel
				amxdBuild={s.amxdBuild}
				// This device's Studio IS strudel.cc - the real app, local and offline -
				// so the button that would send you to the website opens that instead.
				onOpenStrudel={openStudio}
				onClose={() => setShowAbout(false)}
				debug={debug}
			/>
		);
	}

	const error = s.status.phase === "error" ? s.status.message : null;

	return (
		<div className="device flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
			<div className="flex items-center gap-1 text-[11px]">
				<button
					onClick={() => setShowAbout(true)}
					className="shrink-0 text-xs font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
				>Gugelhupf</button>
				{/* The transport is Live's parameter, and it drives whichever engine owns
				    it. When the Studio does, this page has no `live` of its own to show -
				    the parameter is the only thing that knows, so read it directly. */}
				{/* Run is the SCRATCHPAD's and always claims the transport for it; Stop
				    stops whatever is playing, which is the Studio while it holds it. */}
				<RunButton
					className="ml-auto"
					live={owner === "studio" ? !!play : s.live}
					onRun={runScratchpad}
					onStop={owner === "studio" ? () => setPlay(false) : s.hush}
					title={
						owner === "studio"
							? "The STUDIO is playing. Stop it here, or press Run to hand the track to this page's scratchpad."
							: "Run this page's scratchpad - it has the track. The Studio takes it back when you evaluate there."
					}
				/>
				{/* Allowed while playing: the bounce takes superdough's context over for its
				    duration, so playback goes quiet and resumes (useStrudelRender). */}
				<ExportButton
					onExport={s.exportAudio}
					busy={s.exporting}
					title="Export: render THIS PAGE's pattern to a WAV next to the device, then drag it into a track. The Studio's own pattern is not bounced - it renders in its own runtime, not this one."
				/>
				{/* The local strudel.cc, in its own window, playing straight into the track. */}
				<Button onClick={openStudio} variant="ghost" title="Open the local strudel.cc - the full REPL, playing into this track">
					REPL
				</Button>
				<ControlsButton
					onShow={() => setShowTransport(true)}
					title="Controls: the native panel with the mappable Play/Stop and the eight slider knobs (S1..S8). Its Back switch returns."
				/>
				<HelpButton onOpen={helpWindow.open} />
			</div>

			{/* THREE VIEWS, and a strip to pick one. The device view is 169 px tall and
			    does not scroll, so only one of them can be up at a time and the strip is
			    icons rather than tabs. */}
			<div className="flex min-h-0 flex-1 gap-1">
				<div className="flex shrink-0 flex-col gap-0.5">
					{VIEWS.map((v) => (
						<Button
							key={v.id}
							icon={v.icon}
							variant="ghost"
							size="icon"
							title={v.title}
							active={view === v.id}
							onClick={() => {
								setView(v.id);
								setViewPinned(true);
							}}
						/>
					))}
				</div>

				{/* A COLUMN, so a child asking for flex-1 actually fills it. Without this
				    the editor fell back to its own min-height and sat at 48 px in a pane
				    three times that tall. */}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					{view === "visual" && <Visualizer />}
					{view === "knobs" && <FaderBank faders={faders.length ? faders : s.sliders} />}
					{view === "code" && (
						<PatternEditor
							value={s.text}
							onChange={s.setText}
							onCaret={(caret) => setHelpQuery(tokenAtCaret(s.text, caret))}
							onRun={s.run}
							spans={[]}
							invalid={Boolean(error)}
						/>
					)}
				</div>
			</div>

			{error && <span className="truncate text-[10px] leading-none text-destructive">{error}</span>}

			{/* Shown as soon as the FOLDER is known, which is ui_ready - not once something
			    has been exported. The two were tied together while the wrapper only sent the
			    path next to a write, and the copy could then never be tried on a device whose
			    Export was failing. */}
			{(s.exportNote || s.folder) && (
				<div className="flex items-center gap-2">
					<span className="flex-1 truncate text-[10px] leading-none text-muted-foreground" title={s.exportNote ?? s.folder ?? ""}>
						{s.exportNote ?? s.folder}
					</span>
					<Button
						icon={ClipboardCopy}
						onClick={s.copyFolder}
						disabled={!s.folder}
						title="Copy the exported file's full path to the clipboard - the device folder, until something has been exported"
					/>
				</div>
			)}

			{s.samplesNote && !error && !s.exportNote && (
				<span className="truncate text-[10px] leading-none text-amber-500" title={s.samplesNote}>
					{s.samplesNote}
				</span>
			)}
		</div>
	);
}
