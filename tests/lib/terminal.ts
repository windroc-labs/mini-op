// A fake mini Terminal for script tests. osascript's terminal.js and keys.js and the sleep command
// answer from files in the sandbox dir (front, screen, lands, runs) and log to events and sleeps;
// with lands, typed text reaches the screen, and with runs a real zsh -f runs it, so the markers a
// typed command writes land in the sandbox's ~/apm as on the mini.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Sandbox } from "./sandbox.ts";

const SCREEN = `{ cat "$FAKE_DIR/screen" 2>/dev/null || print -rn -- 'mini ~ % '; }; print`;
const TYPE = `print type >> "$FAKE_DIR/events"
text=$(cat; print x); text=\${text%x}; print -rn -- "$text" > "$FAKE_DIR/typed"
[[ -e $FAKE_DIR/lands ]] || exit 0
out=$text$'\\n'
if [[ -e $FAKE_DIR/runs ]]; then out+=$(zsh -f -c "$text" 2>&1; print x); out=\${out%x}; fi
print -rn -- "mini ~ % \${out}mini ~ % " > "$FAKE_DIR/screen"`;
const ACTIVATE = `print activate >> "$FAKE_DIR/events"
front=$(<"$FAKE_DIR/front")
[[ $front == Terminal ]] || { print -u2 -- "terminal: Terminal not frontmost ($front)"; exit 1; }
print Terminal`;
export const SLEEP = `print -r -- "$1" >> "$FAKE_DIR/sleeps"
clock=$(cat "$FAKE_DIR/clock" 2>/dev/null || print 0); print $(( clock + $1 )) > "$FAKE_DIR/clock"`;

// dialogs: what ~/apm/bin/dialogs lists (termwait --until-input reads it).
export type TerminalScene = {
  front?: string;
  lands?: boolean;
  runs?: boolean;
  screen?: string;
  dialogs?: string;
};

export function fakeTerminal(sb: Sandbox, scene: TerminalScene = {}, sleep = SLEEP): void {
  const file = (name: string) => path.join(sb.dir, name);
  fs.writeFileSync(file("front"), scene.front ?? "Terminal");
  if (scene.screen !== undefined) fs.writeFileSync(file("screen"), scene.screen);
  for (const name of ["lands", "runs"] as const) {
    if (scene[name] ?? true) fs.writeFileSync(file(name), "");
  }
  const log = (event: string) => `print ${event} >> "$FAKE_DIR/events"; `;
  sb.fake("osascript", [
    { program: "terminal.js", args: ["activate"], shell: ACTIVATE },
    { program: "terminal.js", args: ["history"], shell: log("history") + SCREEN },
    { program: "terminal.js", args: ["contents"], shell: log("contents") + SCREEN },
    { program: "terminal.js", args: ["bottom"], shell: log("bottom") + "print bottom" },
    { program: "keys.js", args: ["--enter"], shell: TYPE },
    ...(scene.dialogs === undefined ? [] : [{ program: "dialogs.js", stdout: scene.dialogs }]),
  ]);
  sb.fake("sleep", [{ shell: sleep }]);
  sb.fake("date", [
    {
      shell: 'clock=$(cat "$FAKE_DIR/clock" 2>/dev/null || print 0); print -r -- "${clock%.*}"',
      ignoresStdin: true,
    },
  ]);
}

function readIfExists(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function lines(sb: Sandbox, name: string): string[] {
  return (readIfExists(path.join(sb.dir, name)) ?? "").split("\n").filter(Boolean);
}

export const events = (sb: Sandbox) => lines(sb, "events");
export const sleeps = (sb: Sandbox) => lines(sb, "sleeps");

export const typed = (sb: Sandbox) => readIfExists(path.join(sb.dir, "typed"));
