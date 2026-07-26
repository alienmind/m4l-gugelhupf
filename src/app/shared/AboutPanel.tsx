import { ChevronLeft, ExternalLink } from "lucide-react";
import { Button } from "./Button";
import { openExternal } from "./openExternal";

export function AboutPanel({
	amxdBuild,
	onOpenStrudel,
	onClose,
	debug,
}: {
	amxdBuild: string;
	/**
	 * What the strudel.cc button should do INSTEAD of opening the website.
	 *
	 * The main Strudel device passes its own Studio here: that window is the real
	 * strudel.cc, offline, so sending its user to the internet copy would be worse.
	 * Every other device leaves it out and gets the plain external link.
	 */
	onOpenStrudel?: () => void;
	onClose: () => void;
	/** Debug-only render/transport readout (superdough). Shown in a small mono block so it
	 *  is available when needed but out of the way of the device view. */
	debug?: string;
}) {
	return (
		<div className="flex h-full w-full flex-col gap-1 overflow-hidden bg-background p-1.5 text-foreground">
			<div className="flex items-center gap-2 border-b border-input pb-1 mb-2 leading-none">
				<button
					onClick={onClose}
					className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
					title="Back"
				>
					<ChevronLeft className="size-4" />
				</button>
				<span className="text-xs font-semibold tracking-tight">About this device</span>
			</div>
			
			{/* Scroll, top-aligned: the device view is ~169px and the Advanced section (Full
			    Studio / Controls) sits below the version box - centering + overflow-hidden used
			    to push it off the bottom, so it looked like the Studio button had vanished. */}
			<div className="flex flex-col flex-1 items-center justify-start gap-3 overflow-y-auto text-center px-4">
				<div>
					<h1 className="text-base font-bold text-foreground">m4l-gugelhupf</h1>
					{/* NOT an <a>: a link followed inside the device's webview strands the
					    user in a page with no back button and no way out but reloading the
					    device. It opens in their own browser instead. */}
					<Button
						variant="link"
						onClick={() => openExternal("https://github.com/alienmind/m4l-gugelhupf")}
						className="mt-1 w-full text-xs"
					>
						github.com/alienmind/m4l-gugelhupf
					</Button>
				</div>
				
				<div className="flex flex-col gap-1 text-[10px] text-muted-foreground bg-input/20 rounded p-2 border border-input w-full max-w-[200px]">
					<div className="flex justify-between">
						<span>UI Version:</span>
						<span className="font-mono text-foreground">{__APP_VERSION__}</span>
					</div>
					<div className="flex justify-between">
						<span>AMXD Build:</span>
						<span className="font-mono text-foreground">{amxdBuild}</span>
					</div>
					{amxdBuild !== "?" && amxdBuild !== __APP_VERSION__ && (
						<div className="text-destructive mt-1 font-semibold">
							Version mismatch (stale install)
						</div>
					)}
				</div>

				<div className="flex w-full max-w-[220px] flex-col gap-1">
					<span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">Advanced</span>
					<div className="flex flex-wrap justify-center gap-1">
						<Button
							icon={ExternalLink}
							onClick={onOpenStrudel ?? (() => openExternal("https://strudel.cc"))}
							title="Open strudel.cc in your browser, outside Live"
						>
							Take me to Strudel.cc
						</Button>
					</div>
				</div>

				{debug && (
					<div className="w-full max-w-[220px] whitespace-pre-wrap break-words rounded border border-input bg-input/20 p-2 text-left font-mono text-[9px] leading-tight text-muted-foreground">
						{debug}
					</div>
				)}

				<div className="text-[10px] text-muted-foreground mt-2 pb-2">
					Copyright Alienmind, 2026
				</div>
			</div>
		</div>
	);
}
