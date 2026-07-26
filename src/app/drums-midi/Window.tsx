import { RotateCcw } from "lucide-react";
import { useStateSync } from "@m4l-jweb/surface/react";
import { DEFAULT_DRUM_MAP, type DrumMap } from "@/lib/mini/drums";
import { DrumRack } from "./DrumRack";
import surface from "./surface";

/**
 * The EXPANDED drum rack - a floating window, opened optionally from the device
 * view's "Expand" button. It is the SAME DrumRack the mini view draws, given a wide
 * range (C1..C6) instead of a 16-pad window, so there is no scroll stripe: it shows
 * every pad at once and larger.
 *
 * It binds the `drumMap` state slot with useStateSync, exactly as the device does, so
 * a change here and a change in the mini rack are one write to one persisted [dict]
 * and the library keeps every open view in sync.
 *
 * A SEPARATE bundle from App.tsx (surface.ts declares `entry: "Window"`), with its
 * own Chromium context: it shares no React state with the device view and reaches it
 * only through Max - which is what useStateSync does under the hood.
 */

// C1 = 36, C6 = 96 in Live's Drum Rack convention (C-2 = 0).
const LOW = 36;
const HIGH = 96;

export default function DrumRackWindow() {
	const [map, setMap] = useStateSync(surface, "drumMap");

	return (
		<main className="flex h-screen w-screen flex-col gap-3 overflow-hidden bg-background p-4 text-foreground">
			<div className="flex items-baseline justify-between border-b border-input pb-2">
				<h1 className="text-sm font-semibold tracking-tight">Gugelhupf Drum Rack</h1>
				<div className="flex items-baseline gap-3">
					<span className="text-xs text-muted-foreground">C1 to C6 &middot; type a word or drag one onto a pad</span>
					<button
						onClick={() => setMap({ ...DEFAULT_DRUM_MAP } as DrumMap)}
						className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground hover:brightness-110"
						title="Back to the General MIDI defaults"
					>
						<RotateCcw className="size-3.5" />
						Reset
					</button>
				</div>
			</div>

			<DrumRack map={map} onChange={setMap} lowNote={LOW} highNote={HIGH} size="lg" />
		</main>
	);
}
