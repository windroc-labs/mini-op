// osascript facts the sandbox fake and the guards share.
import * as path from "node:path";

// osascript's program file (its basename, and as given), or none for an -e or stdin program; whether
// an -e program was given; the -l language (osascript's default, AppleScript, without one); and the
// arguments after the program.
export function osascriptProgram(args: string[]): {
  program?: string;
  file?: string;
  inline: boolean;
  language: string;
  rest: string[];
} {
  let inline = false;
  let language = "AppleScript";
  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? "";
    if (arg === "-e") {
      inline = true;
      i += 2;
    } else if (arg === "-l") {
      language = args[i + 1] ?? "";
      i += 2;
    } else if (arg === "-s") {
      i += 2;
    } else if (arg === "--") {
      i += 1;
      break;
    } else if (arg.startsWith("-") && arg !== "-") {
      i += 1;
    } else {
      break;
    }
  }
  if (inline || i >= args.length || args[i] === "-")
    return { inline, language, rest: args.slice(i) };
  const file = args[i] ?? "";
  return { program: path.basename(file), file, inline, language, rest: args.slice(i + 1) };
}

// AppleScript-only syntax: JXA's se.keystroke(…) and se.keyCode(…) never match.
const MARKERS = [
  /\btell\s+(?:app|application)\b/,
  /\bend\s+tell\b/,
  /\bon\s+run\b/,
  /\bkey\s+(?:down|up|code)\s+[\w$]/,
  /(?<![.\w])keystroke\b(?!\s*\()/,
];

// The offsets in text where AppleScript syntax starts, ascending; a fresh regex per call.
export function appleScriptOffsets(text: string): number[] {
  const found = new Set<number>();
  for (const marker of MARKERS) {
    for (const match of text.matchAll(new RegExp(marker.source, "gi"))) found.add(match.index);
  }
  return [...found].sort((a, b) => a - b);
}
