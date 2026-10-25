import * as path from "node:path";
import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { loadSecrets } from "../lib/registry.ts";
import { isShipped, scanned, shellKind } from "../lib/repo.ts";
import { FORBIDDEN } from "../lib/sandbox.ts";
import { COMMAND_START, shellCode } from "../lib/shell.ts";

// FR-31: shipped code has no test switches and calls tools by name; tests never reach real tools
// around the sandbox. Paths are built from parts so this file never matches itself.
const SWITCH = /\b(?:[A-Za-z_][A-Za-z0-9_]*_TEST|FORCE_[A-Za-z0-9_]+)\b/g;
const ENV = "/u" + "sr/bin/env";
const COMMAND = new RegExp(COMMAND_START + "(/[^\\s;&|()<>]+)", "gm");
const TOOL_PREFIXES = ["/b" + "in/", "/sb" + "in/", "/u" + "sr/", "/opt/" + "homebrew"];
const SYSTEM_DIRS = new Set(
  ["bin", "sbin", "usr/bin", "usr/sbin", "usr/local/bin", "opt/homebrew/bin"].map((d) => "/" + d),
);
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const SETS_PATH = /process\.env(?:\.PATH|\[["']PATH["']\])\s*=(?!=)/g;

function shipped(file: string, text: string, exempt: string, found: Violation[]): void {
  for (const match of text.matchAll(SWITCH)) {
    if (match[0] === exempt) continue;
    found.push({
      file,
      line: lineAt(text, match.index),
      message: `test switch ${match[0]} in shipped code`,
    });
  }
  if (!shellKind(file, text)) return;
  const shebang = /^#!\s*(\S+)/.exec(text);
  if (shebang && shebang[1] !== ENV) {
    found.push({ file, line: 1, message: "shebang must be #!/usr/bin/env <interpreter>" });
  }
  const code = shellCode(text, { strings: "blank" });
  for (const match of code.matchAll(COMMAND)) {
    const cmd = match[1] ?? "";
    const at = match.index + match[0].lastIndexOf(cmd);
    const start = code.lastIndexOf("\n", at - 1) + 1;
    const previous =
      code
        .slice(0, Math.max(start - 1, 0))
        .split("\n")
        .at(-1) ?? "";
    // A line continued with a bare \ holds more arguments; after && || | ; ( it starts a command.
    const continued = /\\\s*$/.test(previous);
    const separated = /(?:&&|\|\||[|;(])\s*\\\s*$/.test(previous);
    if (code.slice(start, at).trim() === "" && continued && !separated) continue;
    if ((FORBIDDEN as readonly string[]).includes(path.basename(cmd))) continue;
    found.push({
      file,
      line: lineAt(code, at),
      message: `runs ${cmd} by absolute path; call it by name`,
    });
  }
}

function tests(file: string, text: string, found: Violation[]): void {
  for (const match of text.matchAll(LITERAL)) {
    const value = match[2] ?? "";
    const line = lineAt(text, match.index);
    // What a fake prints (`stdout: "/usr/bin/nc\n"`) is output, not a tool the test runs.
    if (/\b(?:stdout|stderr)\s*:\s*$/.test(text.slice(0, match.index))) continue;
    if (SYSTEM_DIRS.has(value) || value.split(":").some((entry) => SYSTEM_DIRS.has(entry))) {
      found.push({ file, line, message: "puts a system dir on PATH" });
    } else if (TOOL_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      found.push({ file, line, message: "names a real tool path; run tools by name in a Sandbox" });
    }
  }
  for (const match of text.matchAll(SETS_PATH)) {
    found.push({ file, line: lineAt(text, match.index), message: "sets PATH" });
  }
}

export const guard: Guard = {
  name: "test_boundary",
  check(view) {
    const found: Violation[] = [];
    const exempt = loadSecrets(view.read).variable;
    for (const file of scanned(view)) {
      if (isShipped(file)) shipped(file, view.read(file), exempt, found);
      else if (file.startsWith("tests/") && file.endsWith(".ts"))
        tests(file, view.read(file), found);
    }
    return found;
  },
};
