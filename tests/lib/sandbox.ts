// The test sandbox: scripts run with a PATH of fakes, traps and allowlisted real tools only, a temp
// HOME and TMPDIR, and the secrets dir pointing at a canary inside the sandbox.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APM_DIRS, REPO } from "./repo.ts";
import { SECRETS_LITERAL } from "./literals.ts";
import { FAKE_LOCAL, FAKE_SSH_CONFIG, MINI_USER } from "./ssh_config.ts";
import { SandboxError, Tripwire } from "./tripwire.ts";

export { REPO, SandboxError };
export const OVERRIDE = "MINI_OP_SECRETS_DIR";
const FAKE = path.join(REPO, "tests/lib/fake.ts");
// Shared by every sandbox, so each fake call after the first loads fake.ts compiled.
export const FAKE_CACHE = path.join(os.tmpdir(), "mini-op-fake-cache");
// Variables only the sandbox sets: tests passing them could reach real tools or skew the trace.
const RESERVED = ["PATH", "HOME", "TMPDIR", "ZDOTDIR", "BASH_ENV", "MINI_OP_TRACE_FILE"];

// Shell startup hooks that append "<file>:<line>" for every command run to $MINI_OP_TRACE_FILE,
// on their own fd so stdout and stderr stay as the script wrote them (zsh has no xtrace fd).
const ZSHENV = `[[ -n $MINI_OP_TRACE_FILE ]] || return 0
exec {__mini_op_trace}>>$MINI_OP_TRACE_FILE
TRAPDEBUG() { print -u $__mini_op_trace -r -- "\${\${funcfiletrace[1]%:*}:A}:\${funcfiletrace[1]##*:}"; }
`;
const BASH_ENV = `[ -n "\${MINI_OP_TRACE_FILE:-}" ] || return 0
exec 19>>"$MINI_OP_TRACE_FILE"
set -T
trap 'printf "%s:%s\\n" "\${BASH_SOURCE[0]}" "$LINENO" >&19' DEBUG
`;

// Commands that must never be real inside the sandbox: they reach the mini, the keychain, the
// clipboard, the screen or the network.
export const FORBIDDEN = [
  "ssh",
  "scp",
  "osascript",
  "security",
  "docker",
  "curl",
  "pbpaste",
  "pbcopy",
  "screencapture",
  "tmux",
  "opencli",
] as const;

export const ALLOWLIST = [
  ..."sh bash zsh env cat cp mv rm mkdir rmdir ln ls chmod touch printf echo sed grep awk cut tr".split(
    " ",
  ),
  ..."head tail sort uniq wc tee date sleep dirname basename readlink realpath mktemp mkfifo stat find".split(
    " ",
  ),
  ..."xargs tar gzip od base64 diff cmp id uname true false kill perl shasum sha256sum git node jq".split(
    " ",
  ),
];

// The sandbox's own files and dirs: leaks() never counts a secret found in them.
export const INFRA = [
  "bin",
  "allow",
  "real",
  "fakes",
  "secrets",
  "zdotdir",
  "bash_env",
  "calls.jsonl",
  "state.json",
  "remote.json",
  "unfaked.jsonl",
  "tripped.jsonl",
  "tools.log",
];

export type FakeRule = {
  argv?: string[];
  program?: string;
  args?: string[];
  when?: Record<string, string>;
  set?: Record<string, string>;
  stdout?: string;
  stdoutBase64?: string;
  stdoutFromState?: string;
  stderr?: string;
  exit?: number;
  // ssh only: run the remote command locally with the sandbox's zsh, as the mini would.
  local?: boolean;
  // A zsh script run instead of the outputs above, as `zsh -c <shell> <name> <args>`: osascript's
  // args after the program, else argv. It gets the call's stdin and env plus FAKE_DIR, the
  // sandbox dir, for state of its own (a Terminal running typed text, a counting sleep).
  shell?: string;
  // The tool never reads stdin (ioreg, sleep): the fake leaves it to the next reader.
  ignoresStdin?: boolean;
};

// What a local fake ssh needs: the env and zsh the "remote" side gets, and the repo whose tripwire
// it checks.
export type Remote = { env: Record<string, string>; zsh: string; repo: string };

export type FakeCall = {
  cmd: string;
  argv: string[];
  env: Record<string, string>;
  stdin: string;
  cwd: string;
  program?: string;
  matched: number | null;
};

export type RunResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  // With stdinFile: how many bytes of it the run read (its shared file offset at the end).
  stdinOffset?: number;
};

export type RunOptions = {
  input?: string;
  // A sandbox file opened as the child's stdin in place of input, so a read moves its offset.
  stdinFile?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
};

type AfterHook = { after(fn: () => void | Promise<void>): void };

function inside(dir: string, target: string): boolean {
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    real = path.resolve(target);
  }
  return real === dir || real.startsWith(dir + path.sep);
}

function findTool(name: string, skip: string): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry || inside(skip, entry)) continue;
    const candidate = path.join(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function quote(value: string): string {
  if (value.includes("'")) throw new SandboxError(`sandbox: cannot quote ${value}`);
  return `'${value}'`;
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

// Where an fd's shared offset stands: readFileSync on an fd reads from there to the end.
function readOffset(fd: number): number {
  const offset = fs.fstatSync(fd).size - fs.readFileSync(fd).length;
  fs.closeSync(fd);
  return offset;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Sandbox {
  readonly dir: string;
  readonly home: string;
  readonly secrets: string;
  // The mini account's password file in the secrets dir: it holds the canary.
  readonly passwordFile: string;
  readonly canary: string;
  private readonly bin: string;
  private readonly path: string;
  private readonly repo: string;
  private readonly tripwire: Tripwire;
  private readonly trace: string;
  private readonly outputs: { stdout: string; stderr: string }[] = [];

  private constructor(dir: string, repo: string, trace: string) {
    this.repo = fs.realpathSync(repo);
    this.tripwire = new Tripwire(this.repo);
    this.dir = dir;
    this.home = path.join(dir, "home");
    this.secrets = path.join(dir, "secrets");
    this.passwordFile = path.join(this.secrets, MINI_USER);
    this.bin = path.join(dir, "bin");
    this.path = `${this.bin}:${path.join(dir, "allow")}`;
    this.canary = `canary-${randomBytes(8).toString("hex")}`;
    this.trace = trace;
  }

  // `repo` (default: this checkout) is where the registries and the files the tripwire checks live.
  // `trace` (default: $MINI_OP_TRACE, "" for none) is a dir that collects executed shell lines.
  static async create(
    t: AfterHook,
    opts: { repo?: string; trace?: string } = {},
  ): Promise<Sandbox> {
    const overlap = ALLOWLIST.filter((tool) => (FORBIDDEN as readonly string[]).includes(tool));
    if (overlap.length > 0) throw new SandboxError(`sandbox: allowlist holds ${overlap.join(" ")}`);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-")));
    const sb = new Sandbox(dir, opts.repo ?? REPO, opts.trace ?? process.env.MINI_OP_TRACE ?? "");
    t.after(() => sb.dispose());
    for (const sub of ["bin", "allow", "real", "home", "tmp", "secrets", "fakes"]) {
      fs.mkdirSync(path.join(sb.dir, sub));
    }
    fs.writeFileSync(sb.passwordFile, sb.canary, { mode: 0o400 });
    // The user's local config with the fake values, and the ssh config host/config generates
    // from it (tests that need them missing or different rewrite them).
    fs.mkdirSync(path.join(sb.home, ".mini-op"), { mode: 0o700 });
    fs.writeFileSync(path.join(sb.home, ".mini-op/config.local.yaml"), FAKE_LOCAL);
    fs.writeFileSync(path.join(sb.home, ".mini-op/ssh_config"), FAKE_SSH_CONFIG);
    fs.writeFileSync(path.join(sb.dir, "state.json"), "{}");
    if (sb.trace) {
      fs.mkdirSync(path.join(sb.dir, "zdotdir"));
      fs.writeFileSync(path.join(sb.dir, "zdotdir/.zshenv"), ZSHENV);
      fs.writeFileSync(path.join(sb.dir, "bash_env"), BASH_ENV);
    }
    for (const name of ALLOWLIST) {
      const real = findTool(name, sb.dir);
      if (real) sb.toolShim(name, real);
    }
    for (const name of FORBIDDEN) sb.shim(name);
    const remote: Remote = {
      env: sb.environment({}),
      zsh: path.join(sb.dir, "allow", "zsh"),
      repo: sb.repo,
    };
    fs.writeFileSync(path.join(sb.dir, "remote.json"), JSON.stringify(remote));
    await sb.checkShellPath();
    return sb;
  }

  // /etc/zshenv and the like run before any script and could put real tools back on PATH.
  private async checkShellPath(): Promise<void> {
    for (const shell of ["zsh", "bash"]) {
      if (!fs.existsSync(path.join(this.dir, "allow", shell))) continue;
      const r = await this.run([shell, "-c", 'printf "%s" "$PATH"']);
      if (r.stdout !== this.path) {
        throw new SandboxError(`sandbox: ${shell} startup files change PATH to ${r.stdout}`);
      }
    }
  }

  private shim(name: string): void {
    const file = path.join(this.bin, name);
    const args = [process.execPath, "--no-warnings", FAKE, this.dir, name].map(quote).join(" ");
    const cache = `NODE_COMPILE_CACHE=${quote(FAKE_CACHE)}`;
    fs.writeFileSync(file, `#!/bin/sh\n${cache} exec ${args} "$@"\n`, { mode: 0o755 });
  }

  // A real tool behind a shim that logs its name, argv and exported env to tools.log (FR-36). It
  // runs through real/<name>, a link, so multi-call binaries still see their name.
  private toolShim(name: string, real: string): void {
    const link = path.join(this.dir, "real", name);
    fs.symlinkSync(real, link);
    const log = quote(path.join(this.dir, "tools.log"));
    const entry = `printf 'tool: %s\\nargv:' ${quote(name)}; printf ' %s' "$@"; printf '\\n'`;
    const body = `{ ${entry}; export -p; } >> ${log}`;
    fs.writeFileSync(
      path.join(this.dir, "allow", name),
      `#!/bin/sh\n${body}\nexec ${quote(link)} "$@"\n`,
      {
        mode: 0o755,
      },
    );
  }

  fake(cmd: string, rules: FakeRule[] = [{}]): void {
    if (!/^[A-Za-z0-9._-]+$/.test(cmd)) throw new SandboxError(`sandbox: bad command name ${cmd}`);
    if (cmd !== "ssh" && rules.some((rule) => rule.local)) {
      throw new SandboxError("sandbox: local works for ssh only");
    }
    fs.writeFileSync(path.join(this.dir, "fakes", `${cmd}.json`), JSON.stringify(rules));
    this.shim(cmd);
  }

  // Lays out ~/apm in the sandbox home as the mini has it: a link per file of `root`'s APM_DIRS.
  // Files the tripwire refuses get a stub that records the trip and exits 126 instead.
  mini(root = path.join(REPO, "mini")): void {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    for (const sub of APM_DIRS) {
      const from = path.join(root, sub);
      if (!fs.existsSync(from)) continue;
      for (const file of walk(from)) {
        const dest = path.join(this.home, "apm", sub, path.relative(from, file));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const real = fs.realpathSync(file);
        const reason = this.tripwire.fileTrips(
          path.relative(this.repo, real),
          fs.readFileSync(real, "utf8"),
        );
        if (reason === undefined) {
          fs.symlinkSync(real, dest);
          continue;
        }
        const line = JSON.stringify({ reason: `${reason}, reached through ~/apm` });
        fs.writeFileSync(
          dest,
          `#!/bin/sh\nprintf '%s\\n' ${quote(line)} >> ${quote(path.join(this.dir, "tripped.jsonl"))}\nexit 126\n`,
          { mode: 0o755 },
        );
      }
    }
  }

  setState(values: Record<string, string>): void {
    fs.writeFileSync(
      path.join(this.dir, "state.json"),
      JSON.stringify({ ...this.state(), ...values }),
    );
  }

  state(): Record<string, string> {
    return JSON.parse(fs.readFileSync(path.join(this.dir, "state.json"), "utf8"));
  }

  calls(cmd?: string): FakeCall[] {
    return this.readLog("calls.jsonl").filter(
      (call: FakeCall) => cmd === undefined || call.cmd === cmd,
    );
  }

  private readLog(name: string): any[] {
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  private environment(opts: RunOptions): Record<string, string> {
    for (const key of RESERVED) {
      if (opts.env && key in opts.env) throw new SandboxError(`sandbox: tests may not set ${key}`);
    }
    const env: Record<string, string | undefined> = {
      PATH: this.path,
      HOME: this.home,
      TMPDIR: path.join(this.dir, "tmp"),
      LANG: "C.UTF-8",
      [OVERRIDE]: this.secrets,
      ...(this.trace && {
        ZDOTDIR: path.join(this.dir, "zdotdir"),
        BASH_ENV: path.join(this.dir, "bash_env"),
        MINI_OP_TRACE_FILE: path.join(this.trace, `${path.basename(this.dir)}.trace`),
      }),
      ...opts.env,
    };
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) if (value !== undefined) clean[key] = value;
    return clean;
  }

  private checkSecrets(env: Record<string, string>): void {
    const value = env[OVERRIDE];
    const bad = new SandboxError(`sandbox: ${OVERRIDE} must point inside ${this.dir}`);
    if (!value || !inside(this.dir, value)) throw bad;
    // Every entry of the dir scripts will read must stay inside too: no links out to real secrets.
    if (fs.existsSync(value) && fs.statSync(value).isDirectory()) {
      for (const entry of fs.readdirSync(value)) {
        if (!inside(this.dir, path.join(value, entry))) throw bad;
      }
    }
  }

  // The stdinFile's text, once its path is known to stay inside the sandbox.
  private stdinText(opts: RunOptions): string {
    const file = opts.stdinFile;
    if (file === undefined) return opts.input ?? "";
    if (opts.input !== undefined)
      throw new SandboxError("sandbox: pass input or stdinFile, not both");
    if (!inside(this.dir, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new SandboxError(`sandbox: stdinFile must be a file inside ${this.dir}`);
    }
    if ([file, fs.realpathSync(file)].some((p) => p.includes(SECRETS_LITERAL))) {
      throw new SandboxError(`sandbox: stdinFile names the real secrets dir ${SECRETS_LITERAL}`);
    }
    return fs.readFileSync(file, "utf8");
  }

  private checkStrings(argv: string[], opts: RunOptions, env: Record<string, string>): void {
    const strings = [...argv, this.stdinText(opts), ...Object.values(env)];
    if (strings.some((s) => s.includes(SECRETS_LITERAL))) {
      throw new SandboxError(`sandbox: run names the real secrets dir ${SECRETS_LITERAL}`);
    }
    const files: string[] = [];
    for (const arg of argv) {
      const candidate = path.resolve(opts.cwd ?? this.dir, arg);
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      const real = fs.realpathSync(candidate);
      if (inside(this.repo, real)) files.push(real);
    }
    this.tripwire.check(strings, files);
  }

  async run(argv: string[], opts: RunOptions = {}): Promise<RunResult> {
    const env = this.environment(opts);
    this.checkSecrets(env);
    this.checkStrings(argv, opts, env);
    const [command, ...args] = argv;
    if (!command) throw new SandboxError("sandbox: empty argv");
    fs.writeFileSync(path.join(this.dir, "unfaked.jsonl"), "");
    fs.writeFileSync(path.join(this.dir, "tripped.jsonl"), "");
    const timeoutMs = opts.timeoutMs ?? 15000;
    const stdin = opts.stdinFile === undefined ? undefined : fs.openSync(opts.stdinFile, "r");
    const child = spawn(command, args, {
      cwd: opts.cwd ?? this.dir,
      env,
      detached: true,
      stdio: [stdin ?? "pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    // Piped, so never null; an fd for stdin only loses node's per-element stdio types.
    child.stdout!.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => err.push(chunk));
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input ?? "");
    const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killGroup(child.pid);
    }, timeoutMs);
    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.on("error", (e) => {
          if (stdin !== undefined) fs.closeSync(stdin);
          reject(new SandboxError(`sandbox: cannot run ${command}: ${e.message}`));
        });
        child.on("exit", (code, signal) => resolve({ code, signal }));
      },
    ).finally(() => clearTimeout(timer));
    let leftover = false;
    if (child.pid && !timedOut) {
      for (let waited = 0; groupAlive(child.pid) && waited < 500; waited += 25) await sleep(25);
      if (groupAlive(child.pid)) {
        leftover = true;
        killGroup(child.pid);
      }
    }
    await Promise.race([closed, sleep(2000)]);
    const stdinOffset = stdin === undefined ? undefined : readOffset(stdin);
    const problems: string[] = [];
    if (timedOut) problems.push(`timed out after ${timeoutMs} ms`);
    if (leftover) problems.push("left processes behind (killed)");
    const unfaked = [...new Set(this.readLog("unfaked.jsonl").map((entry) => entry.cmd))];
    if (unfaked.length > 0) problems.push(`unfaked command called: ${unfaked.join(" ")}`);
    const tripped = [...new Set(this.readLog("tripped.jsonl").map((entry) => entry.reason))];
    if (tripped.length > 0) problems.push(`tripped: ${tripped.join("; ")}`);
    const result = {
      ...exit,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
      ...(stdinOffset !== undefined && { stdinOffset }),
    };
    this.outputs.push({ stdout: result.stdout, stderr: result.stderr });
    if (problems.length > 0) {
      throw new SandboxError(`sandbox: ${command}: ${problems.join("; ")}\n${result.stderr}`);
    }
    return result;
  }

  // Where any of `secrets` (default: the canary) shows up in this sandbox's runs, besides the
  // stdin of a fake in `consumers`: fake argv, env or stdin, real tools' argv and env, the runs'
  // stdout and stderr, and files written outside INFRA (FR-36).
  leaks(opts: { consumers: string[]; secrets?: string[] }): string[] {
    const secrets = opts.secrets ?? [this.canary];
    const has = (text: string) => secrets.some((secret) => text.includes(secret));
    const found: string[] = [];
    for (const call of this.calls()) {
      if (call.argv.some(has)) found.push(`${call.cmd} argv`);
      if (Object.values(call.env).some(has)) found.push(`${call.cmd} env`);
      if (has(call.stdin) && !opts.consumers.includes(call.cmd)) found.push(`${call.cmd} stdin`);
    }
    const tools = path.join(this.dir, "tools.log");
    if (fs.existsSync(tools) && has(fs.readFileSync(tools, "latin1"))) found.push("tools.log");
    if (this.outputs.some((o) => has(o.stdout))) found.push("stdout");
    if (this.outputs.some((o) => has(o.stderr))) found.push("stderr");
    const walk = (rel: string): void => {
      for (const entry of fs.readdirSync(path.join(this.dir, rel), { withFileTypes: true })) {
        const file = rel ? `${rel}/${entry.name}` : entry.name;
        if (!rel && INFRA.includes(entry.name)) continue;
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && has(fs.readFileSync(path.join(this.dir, file), "latin1"))) {
          found.push(`file ${file}`);
        }
      }
    };
    walk("");
    return [...new Set(found)];
  }

  // A test may extract read-only dirs here (tar keeps the modes of CI's read-only shipped dirs):
  // give the owner rwx on each dir first, or rm cannot unlink what they hold.
  dispose(): void {
    if (!inside(fs.realpathSync(os.tmpdir()), this.dir) || !fs.existsSync(this.dir)) return;
    const unlock = (dir: string): void => {
      fs.chmodSync(dir, fs.statSync(dir).mode | 0o700);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) unlock(path.join(dir, entry.name));
      }
    };
    unlock(this.dir);
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
