// A sandbox fake or trap, run by the shim Sandbox writes for each command:
// node fake.ts <sandbox dir> <command> [args...]
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FakeCall, FakeRule, Remote } from "./sandbox.ts";
import { osascriptProgram } from "./osascript.ts";
import { Tripwire } from "./tripwire.ts";

const [dir = "", cmd = "", ...argv] = process.argv.slice(2);
// The shim's compile cache is this node's alone: the logged env and a shell rule never see it.
delete process.env.NODE_COMPILE_CACHE;

// Raw bytes: a shell rule or a local ssh gets binary stdin (an encoded file) intact.
function readStdin(): Buffer {
  try {
    return fs.readFileSync(0);
  } catch {
    return Buffer.alloc(0);
  }
}

function append(file: string, value: unknown): void {
  fs.appendFileSync(path.join(dir, file), JSON.stringify(value) + "\n");
}

function readState(): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
}

// ssh's remote command: the words after the host, joined as ssh joins them.
const SSH_VALUED = new Set("-b -c -D -E -F -i -J -l -L -m -o -p -R -W".split(" "));
function sshCommand(args: string[]): string | undefined {
  let i = 0;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    i += SSH_VALUED.has(args[i] ?? "") ? 2 : 1;
  }
  const words = args.slice(i + 1);
  return words.length > 0 ? words.join(" ") : undefined;
}

// Runs the remote command with the sandbox's zsh and base env, as the mini would, unless the
// tripwire refuses it.
function runLocal(): never {
  const remote: Remote = JSON.parse(fs.readFileSync(path.join(dir, "remote.json"), "utf8"));
  const command = sshCommand(argv);
  if (command === undefined) {
    process.stderr.write("fake ssh: no remote command\n");
    process.exit(255);
  }
  const reason = new Tripwire(remote.repo).trips(command);
  if (reason) {
    append("tripped.jsonl", { reason: `remote command ${reason}` });
    process.stderr.write(`fake ssh: remote command ${reason}\n`);
    process.exit(126);
  }
  const r = spawnSync(remote.zsh, ["-c", command], {
    cwd: remote.env.HOME,
    env: remote.env,
    input: stdin,
    maxBuffer: 1 << 30,
  });
  if (r.stdout) fs.writeSync(1, r.stdout);
  if (r.stderr) fs.writeSync(2, r.stderr);
  process.exit(r.status ?? 1);
}

// Runs the rule's shell script with the sandbox's zsh, the call's args, stdin and env, and FAKE_DIR.
function runShell(script: string, args: string[]): never {
  const remote: Remote = JSON.parse(fs.readFileSync(path.join(dir, "remote.json"), "utf8"));
  const r = spawnSync(remote.zsh, ["-c", script, `fake ${cmd}`, ...args], {
    env: { ...process.env, FAKE_DIR: dir },
    input: stdin,
    maxBuffer: 1 << 30,
  });
  if (r.stdout) fs.writeSync(1, r.stdout);
  if (r.stderr) fs.writeSync(2, r.stderr);
  process.exit(r.status ?? 1);
}

function startsWith(list: string[], prefix: string[]): boolean {
  return prefix.every((item, i) => list[i] === item);
}

type Program = { program?: string; rest: string[] };

function matches(rule: FakeRule, state: Record<string, string>, parsed: Program): boolean {
  if (rule.argv && !startsWith(argv, rule.argv)) return false;
  if (rule.program !== undefined && rule.program !== parsed.program) return false;
  if (rule.args && (parsed.program === undefined || !startsWith(parsed.rest, rule.args)))
    return false;
  return Object.entries(rule.when ?? {}).every(([key, value]) => state[key] === value);
}

const rulesFile = path.join(dir, "fakes", `${cmd}.json`);
if (!fs.existsSync(rulesFile)) {
  append("unfaked.jsonl", { cmd, argv });
  process.stderr.write(`sandbox: no fake for ${cmd}\n`);
  process.exit(127);
}

const rules: FakeRule[] = JSON.parse(fs.readFileSync(rulesFile, "utf8"));
const state = readState();
const parsed: Program = cmd === "osascript" ? osascriptProgram(argv) : { rest: argv };
const index = rules.findIndex((rule) => matches(rule, state, parsed));
const stdin = rules[index]?.ignoresStdin ? Buffer.alloc(0) : readStdin();
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
const call: FakeCall = {
  cmd,
  argv,
  env,
  stdin: stdin.toString("utf8"),
  cwd: process.cwd(),
  matched: index < 0 ? null : index,
};
if (parsed.program !== undefined) call.program = parsed.program;
append("calls.jsonl", call);

const rule = rules[index];
if (!rule) {
  process.stderr.write(`fake ${cmd}: no rule for ${JSON.stringify(argv)}\n`);
  process.exit(127);
}
if (rule.set) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ ...readState(), ...rule.set }));
}
if (rule.local) runLocal();
if (rule.shell !== undefined) runShell(rule.shell, parsed.rest);
if (rule.stdout !== undefined) fs.writeSync(1, rule.stdout);
if (rule.stdoutBase64 !== undefined) fs.writeSync(1, Buffer.from(rule.stdoutBase64, "base64"));
if (rule.stdoutFromState !== undefined) fs.writeSync(1, state[rule.stdoutFromState] ?? "");
if (rule.stderr !== undefined) fs.writeSync(2, rule.stderr);
process.exit(rule.exit ?? 0);
