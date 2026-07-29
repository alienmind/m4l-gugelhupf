import { Download, FolderOpen, Play, SlidersHorizontal, Square } from "lucide-react";
import { Button } from "./Button";

/**
 * The top-bar buttons every device draws, as ONE definition each.
 *
 * They were copies. Six devices each wrote their own `<Button icon={Play} ...>` with its
 * own title text, its own decision about whether to show a label, and its own idea of
 * where in the row it belonged - which is how the MIDI device ended up with "Run"/"Clip"
 * word chips, the FX device with a "Knobs" chip, and the Strudel device with neither. A
 * user who learns a control on one device has learnt nothing about the next one.
 *
 * ICON ONLY, everywhere. A device view is ~169px tall and its top bar is one row; a word
 * costs a third of that row to say what the icon and the tooltip already say. The tooltip
 * carries the full sentence, which is where an explanation belongs.
 *
 * These take callbacks rather than a surface: the hooks (`useParam`, `useWindow`) must be
 * called in the device's own component against the device's own surface - see HelpButton,
 * which has done it this way since the beginning.
 */

/** Run / Stop the pattern. The one toggle in the set that lifts when it is ON. */
export function RunButton({ live, onRun, onStop, className }: {
	live: boolean;
	onRun: () => void;
	onStop: () => void;
	className?: string;
}) {
	return (
		<Button
			className={className}
			icon={live ? Square : Play}
			active={live}
			onClick={live ? onStop : onRun}
			title={
				live
					? "Stop the running pattern"
					: "Evaluate and run this pattern, locked to Live's transport (Ctrl+Enter)"
			}
		/>
	);
}

/**
 * Reveal the device's NATIVE panel - the mappable Play/Stop, the knob pool, or both.
 *
 * A frozen M4L device cannot reposition native objects, so the panel is a separate screen
 * layered over the web UI; its own native Back (or Knobs) switch is the way out. Mapping a
 * Rack macro or a Push encoder is something you do while looking at the device, so this
 * belongs in the top bar on every device that has a panel - not buried in About.
 */
export function ControlsButton({ onShow, title, className }: {
	onShow: () => void;
	/** What the panel actually holds, when it is worth naming (the FX device's is knobs). */
	title?: string;
	className?: string;
}) {
	return (
		<Button
			className={className}
			icon={SlidersHorizontal}
			onClick={onShow}
			title={title ?? "Controls: the native panel behind this view. Its Back switch returns."}
		/>
	);
}

/** Open the clip import/export screen (the MIDI devices). */
export function ClipButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
	return (
		<Button
			className={className}
			icon={FolderOpen}
			onClick={onOpen}
			title="Clip: import a clip into the pattern, or export the pattern to one"
		/>
	);
}

/** Bounce the pattern to a WAV next to the device. */
export function ExportButton({ onExport, busy = false, className, title }: {
	onExport: () => void;
	busy?: boolean;
	className?: string;
	/** Overridden where "this pattern" is ambiguous - the Strudel device has two. */
	title?: string;
}) {
	return (
		<Button
			className={className}
			icon={Download}
			onClick={onExport}
			disabled={busy}
			active={busy}
			title={title ?? "Export: render this pattern to a WAV next to the device, then drag it into a track"}
		/>
	);
}
