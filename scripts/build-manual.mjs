/**
 * build-manual.mjs - USERSMANUAL.md -> a printable HTML page -> a PDF.
 *
 * The manual is markdown because that is what can be reviewed in a diff. The PDF is what
 * ships in the release ZIP, because a user who has just downloaded a Live device is not
 * going to render markdown.
 *
 * WHY A BROWSER AND NOT A PDF LIBRARY. The manual is mostly screenshots and tables, and
 * every JS PDF writer wants those laid out by hand. A headless browser already lays out
 * HTML, and `page.pdf()` is a print, not a screenshot - real text, selectable, with page
 * breaks it decides itself.
 *
 * WHY NOT `puppeteer`, WHICH WOULD BRING ITS OWN. That is ~180 MB of Chromium downloaded on
 * install, in a repo whose whole build otherwise needs nothing but Node. Every machine this
 * runs on already has a Chromium: Windows has Edge, macOS has Chrome or Edge, and GitHub's
 * ubuntu runners ship Google Chrome. So `puppeteer-core` drives whichever is there.
 *
 * IT FAILS SOFT, ON PURPOSE. No browser means no PDF, a warning, and exit 0 - a manual is
 * never worth failing a build that produced every device correctly. The HTML is always
 * written, so `Ctrl+P` from any browser is the manual fallback, and the packaging step
 * skips a doc that is not there (`docs` in patcher/devices.mjs).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "USERSMANUAL.md");
const OUT_DIR = path.join(root, "dist", "manual");
const HTML = path.join(OUT_DIR, "USERSMANUAL.html");
const PDF = path.join(OUT_DIR, "USERSMANUAL.pdf");

/**
 * Every Chromium on this machine, best first - the caller TRIES them in order.
 *
 * A list rather than a single answer, because "it is installed" does not mean "it will
 * render": measured on Windows 11, `msedge.exe` exits 0 the instant it is launched with a
 * remote-debugging port, even with a profile directory of its own, so puppeteer waits for a
 * port that never opens and reports a launch failure about a browser that ran. Chrome on the
 * same machine renders first time. Edge stays on the list below Chrome, for a machine that
 * has only Edge; it is not the one to reach for.
 *
 * `MANUAL_CHROME` wins outright, so an unusual machine can say so instead of waiting for
 * this list to grow.
 */
function findBrowsers() {
  if (process.env.MANUAL_CHROME) return [process.env.MANUAL_CHROME];

  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];

  const found = candidates.filter((c) => existsSync(c));

  // Linux runners sometimes have it somewhere else entirely; ask the shell too.
  if (process.platform !== "win32") {
    for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
      try {
        const which = execFileSync("which", [name], { encoding: "utf8" }).trim();
        if (which && !found.includes(which)) found.push(which);
      } catch {
        /* not on PATH */
      }
    }
  }
  return found;
}

/**
 * Rewrite every image to an absolute file:// URL, and DROP the ones that are not there.
 *
 * A missing screenshot in a PDF is a broken-image glyph in a document a stranger is
 * reading, which is worse than an honest line of text. Placeholders in the markdown (the
 * shots that have not been taken yet) are HTML comments and never reach this, but a
 * renamed or deleted file would - so it is checked rather than assumed.
 */
function resolveImages(html) {
  return html.replace(/<img src="([^"]+)"([^>]*)>/g, (whole, src, rest) => {
    if (/^https?:/.test(src)) return whole; // remote: leave it, and let the print time out on its own
    const abs = path.join(root, src);
    if (!existsSync(abs)) {
      console.warn(`m4l-gugelhupf: manual image ${src} is missing - left out of the PDF`);
      return `<p class="missing-figure">[screenshot: ${path.basename(src)}]</p>`;
    }
    return `<img src="file:///${abs.replace(/\\/g, "/")}"${rest}>`;
  });
}

/** Print CSS. A4, real margins, and nothing that breaks across a page if it can help it. */
const STYLE = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root { color-scheme: light; }
  body {
    font: 10.5pt/1.55 "Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a; margin: 0;
  }
  h1 { font-size: 26pt; letter-spacing: -0.4pt; margin: 0 0 6pt; }
  h1 + p { font-size: 12pt; color: #444; }
  h2 {
    font-size: 15pt; margin: 22pt 0 6pt; padding-bottom: 3pt;
    border-bottom: 1px solid #d8d8d8; break-after: avoid; break-inside: avoid;
  }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; break-after: avoid; }
  h2:first-of-type { margin-top: 16pt; }
  p, li { orphans: 3; widows: 3; }
  code {
    font: 9.5pt/1.4 "Cascadia Mono", Consolas, "SF Mono", monospace;
    background: #f3f3f3; padding: 0.5pt 3pt; border-radius: 2pt;
  }
  pre {
    background: #f7f7f7; border: 1px solid #e4e4e4; border-radius: 3pt;
    padding: 7pt 9pt; break-inside: avoid; overflow-wrap: break-word;
  }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; break-inside: avoid; font-size: 9.5pt; }
  th, td { border: 1px solid #dcdcdc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  img { max-width: 100%; display: block; margin: 9pt auto; border: 1px solid #e0e0e0; border-radius: 3pt; }
  .missing-figure { color: #999; font-style: italic; font-size: 9pt; text-align: center; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 16pt 0; }
  blockquote { margin: 8pt 0; padding-left: 9pt; border-left: 3px solid #dcdcdc; color: #444; }
  a { color: #1a4f8a; text-decoration: none; }
`;

async function main() {
  if (!existsSync(SOURCE)) {
    console.warn("m4l-gugelhupf: no USERSMANUAL.md - nothing to build");
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const body = resolveImages(md.render(readFileSync(SOURCE, "utf8")));

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Gugelhupf ${version} - user's manual</title>
<style>${STYLE}</style></head>
<body>${body}</body></html>`;
  writeFileSync(HTML, html);
  console.log(`m4l-gugelhupf: dist/manual/USERSMANUAL.html (${html.length} bytes)`);

  // Try each browser until one renders. A browser that will not start is the same situation
  // as no browser at all: the HTML is written, the devices are built, and this is a manual -
  // so it warns and returns rather than failing the build around it.
  for (const browser of findBrowsers()) {
    try {
      await renderPdf(browser);
      return;
    } catch (e) {
      console.warn(`m4l-gugelhupf: ${path.basename(browser)} did not render the PDF - ${e.message.split("\n")[0]}`);
    }
  }
  console.warn(
    "m4l-gugelhupf: the PDF was NOT built - no Chromium here would render it.\n" +
      "  Set MANUAL_CHROME to a browser executable, or open dist/manual/USERSMANUAL.html and print it.",
  );
}

async function renderPdf(executablePath) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "m4l-manual-"));
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // A THROWAWAY PROFILE, and neither half of that is optional on a desktop machine.
    // Its own profile, because `msedge.exe` and `chrome.exe` hand their command line to an
    // ALREADY-RUNNING instance and exit 0 at once - puppeteer then waits for a debug port
    // that never opens and reports "Failed to launch the browser process: Code: 0" about a
    // browser that started perfectly. And a FRESH one, because a browser that died leaves
    // a lock behind and the next run refuses the directory it was given.
    userDataDir: profile,
    args: ["--allow-file-access-from-files", "--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = await browser.newPage();
    // A data: URL cannot read local files, and setContent leaves the document's base at
    // about:blank - so the page is loaded from the HTML we just wrote, whose own file://
    // origin is what lets the screenshots resolve.
    await page.goto(`file:///${HTML.replace(/\\/g, "/")}`, { waitUntil: "load" });
    await page.pdf({
      path: PDF,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      // A page number, because a manual gets referred to by one.
      footerTemplate:
        '<div style="width:100%;font:8pt \'Segoe UI\',sans-serif;color:#999;padding:0 16mm;">' +
        '<span style="float:left">Gugelhupf user\'s manual</span>' +
        '<span style="float:right"><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
        "</div>",
      margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
    });
    console.log(`m4l-gugelhupf: dist/manual/USERSMANUAL.pdf (via ${path.basename(executablePath)})`);
  } finally {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
