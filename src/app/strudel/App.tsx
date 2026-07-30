import { useEffect, useState } from "react";
import { Activity, ClipboardCopy, Code, Link, ListPlus, SlidersVertical, Unlink } from "lucide-react";
import { sendToWindow } from "@m4l-jweb/bridge";
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
import surface from "./surface";

/**
 * The device view's three faces. The VISUALIZER is the default because it answers
 * the question a device whose Studio window is shut cannot otherwise answer - is
 * this playing, and what is it doing.
 */
const VIEWS = [
	{ id: "visual", icon: Activity, title: "Visualizer: what the Studio is playing" },
	{ id: "knobs", icon: SlidersVertical, title: "Controls: the pattern's faders, full size" },
	{ id: "code", icon: Code, title: "Code: the pattern, the same one the Studio holds" },
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
	// declared any faders decides whether this page is allowed to name the S1..S8 dials.
	// Two writers, one pool - see useSliderKnobs' `describe`.
	const { faders, declared } = useReplKnobs();
	const s = useStrudelRender(!declared);
	const [play, setPlay] = useParam(surface, "play");
	/**
	 * FOLLOW - whether Live's transport starts this pattern.
	 *
	 * It is here rather than buried in About because bouncing turns it off, and a control
	 * that changed itself has to be visible where the change happened. On an audio track
	 * that has just been bounced into, ON means the clip and the pattern sound together.
	 */
	const [follow, setFollow] = useParam(surface, "follow");

	/**
	 * RUN IS THE STUDIO'S, because the Studio is the only engine. This page edits the
	 * same `code` slot and shows the same pattern; it makes no sound of its own, so
	 * "run" here means: make sure the transport parameter is on, and tell the Studio to
	 * evaluate what it now holds.
	 *
	 * Both messages travel out of this page in order - the keystroke that wrote the slot
	 * has already left by the time the evaluate does - so the Studio evaluates the text
	 * that is on screen here, not the one before it.
	 */
	const run = () => {
		setPlay(true);
		sendToWindow("repl", "evaluate", 1);
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
	useReplRemote();

	if (showAbout) {
		// RENDER HEALTH, debug-only
		const phase = s.status.phase === "idle" ? "Ready - Run evaluates in the Studio" : s.status.message;
		const debug =
			`${phase}\n` +
			`${s.status.phase}` +
			` / ${s.beatsPerCycle} beat${s.beatsPerCycle === 1 ? "" : "s"}/cyc` +
			` / bpm ${Math.round(s.tempo)} / ${play ? "play" : "stop"}`;
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
				{/* The sound is the Studio's, and this page cannot see inside it - so the
				    transport PARAMETER is the only thing that knows whether it is playing. */}
				<RunButton className="ml-auto" live={!!play} onRun={run} onStop={() => setPlay(false)} />
				{/* Allowed while playing: the bounce renders offline, in this page, and
				    never touches the Studio's audio. */}
				<ExportButton
					onExport={s.exportAudio}
					busy={s.exporting}
					title="Export: render this pattern to a WAV next to the device and put it in the highlighted clip slot. On a MIDI track the file still lands - a new audio track is then offered"
				/>
				{/* Only while there is something to escape TO: the last bounce could not
				    become a clip here, and a fresh audio track is the one target that
				    cannot refuse it. Offered, never done unasked. */}
				{s.offerNewTrack && (
					<Button
						icon={ListPlus}
						onClick={s.bounceToNewTrack}
						title="Bounce the last export to a NEW audio track - the one clip target a MIDI track cannot refuse"
					/>
				)}
				<Button
					icon={follow ? Link : Unlink}
					active={!!follow}
					onClick={() => setFollow(!follow)}
					title={
						follow
							? "Following Live's transport: pressing Play starts this pattern. Turn off when a bounced clip on this track should be the sound instead"
							: "Not following Live's transport: only Run starts this pattern. Turn on to have Play start it"
					}
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
							onRun={run}
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
