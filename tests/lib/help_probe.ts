// The help probe (FR-52): runs a script with -h, or with an option it cannot define, in the
// sandbox with every forbidden command faked, and returns its problems as "<file> <arg>: <what>".
import * as fs from "node:fs";
import * as path from "node:path";
import { checkoutStatus } from "./repo.ts";
import { FORBIDDEN, INFRA, REPO, SandboxError, type RunResult, type Sandbox } from "./sandbox.ts";

export type ProbeOptions = { repo?: string };

const UNKNOWN = "--no-such-option";

// Path → size and mtime of every file under the sandbox dir but its INFRA (dirs by name only, as
// an entry made inside one changes its mtime).
function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (!rel && INFRA.includes(entry.name)) continue;
      const file = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        found.set(file, "dir");
        walk(file);
        continue;
      }
      const stat = fs.lstatSync(path.join(dir, file));
      found.set(file, `${stat.size}:${stat.mtimeMs}`);
    }
  };
  walk("");
  return found;
}

const checkout = (repo: string) => new Set(checkoutStatus(repo));

// tools.log entries, "<tool> <args>", from the shims' "tool:" and "argv:" lines (an empty argv
// still logs printf's one space).
function tools(log: string): string[] {
  return [...log.matchAll(/^tool: (.*)\nargv:(.*)$/gm)].map((m) => `${m[1]}${m[2]}`.trimEnd());
}

type Measured = {
  r: RunResult;
  read: boolean;
  ran: string[];
  touched: string[];
};

// One run of `<repo>/<file> <arg>` by its shebang, with a stdin file it must not read: what it
// printed, whether it read stdin, the commands it ran (fakes and real tools, less the one
// interpreter shim its shebang starts) and the files it created, changed or removed.
async function measure(sb: Sandbox, file: string, arg: string, repo: string): Promise<Measured> {
  for (const cmd of FORBIDDEN) sb.fake(cmd, [{ ignoresStdin: true }]);
  const script = path.join(repo, file);
  const stdinFile = path.join(sb.dir, "probe-stdin");
  fs.writeFileSync(stdinFile, "probe\n");
  const toolsLog = path.join(sb.dir, "tools.log");
  const logged = () => (fs.existsSync(toolsLog) ? fs.readFileSync(toolsLog, "latin1") : "");
  const [logBefore, callsBefore] = [logged().length, sb.calls().length];
  const [filesBefore, repoBefore] = [snapshot(sb.dir), checkout(repo)];
  const r = await sb.run([script, arg], { stdinFile });
  const [filesAfter, repoAfter] = [snapshot(sb.dir), checkout(repo)];
  const real = tools(logged().slice(logBefore));
  if (real[0]?.endsWith(` ${script} ${arg}`)) real.shift();
  const ran = [
    ...sb
      .calls()
      .slice(callsBefore)
      .map((call) => [call.cmd, ...call.argv].join(" ")),
    ...real,
  ];
  const touched: string[] = [];
  for (const [rel, stamp] of filesAfter) {
    if (!filesBefore.has(rel)) touched.push(`created ${rel}`);
    else if (filesBefore.get(rel) !== stamp) touched.push(`changed ${rel}`);
  }
  for (const rel of filesBefore.keys()) if (!filesAfter.has(rel)) touched.push(`removed ${rel}`);
  for (const line of repoAfter)
    if (!repoBefore.has(line)) touched.push(`changed the checkout: ${line}`);
  for (const line of repoBefore)
    if (!repoAfter.has(line)) touched.push(`changed the checkout: ${line}`);
  return { r, read: r.stdinOffset !== 0, ran, touched };
}

const firstLine = (text: string) => text.split("\n")[0] ?? "";

// Runs the probe; a SandboxError (a trip, a hang, a process left behind) is its one problem.
async function probe(
  sb: Sandbox,
  file: string,
  arg: string,
  opts: ProbeOptions,
  judge: (m: Measured, name: string) => string[],
): Promise<string[]> {
  let problems: string[];
  try {
    problems = judge(await measure(sb, file, arg, opts.repo ?? REPO), path.basename(file));
  } catch (e) {
    if (!(e instanceof SandboxError)) throw e;
    problems = [firstLine(e.message)];
  }
  return problems.map((problem) => `${file} ${arg}: ${problem}`);
}

// AC11: -h exits 0, prints usage starting "<Name> " to stdout and nothing to stderr, reads no
// stdin, runs no command and leaves every file of the sandbox and the checkout as it was.
export function helpProbe(sb: Sandbox, file: string, opts: ProbeOptions = {}): Promise<string[]> {
  return probe(sb, file, "-h", opts, ({ r, read, ran, touched }, name) => {
    const problems: string[] = [];
    if (r.code !== 0) problems.push(`exited ${r.code ?? r.signal}, not 0`);
    if (r.stdout === "") problems.push("stdout is empty");
    else if (!r.stdout.startsWith(`${name} `))
      problems.push(`stdout does not start with '${name} '`);
    if (r.stderr !== "") problems.push(`wrote stderr: ${firstLine(r.stderr)}`);
    if (read) problems.push("read stdin");
    return [...problems, ...ran.map((cmd) => `ran ${cmd}`), ...touched];
  });
}

// AC12: an option the script cannot define is a usage error: exit 2, nothing on stdout, stderr
// starting "<Name>: ", no command run.
export function optionProbe(sb: Sandbox, file: string, opts: ProbeOptions = {}): Promise<string[]> {
  return probe(sb, file, UNKNOWN, opts, ({ r, ran }, name) => {
    const problems: string[] = [];
    if (r.code !== 2) problems.push(`exited ${r.code ?? r.signal}, not 2`);
    if (r.stdout !== "") problems.push(`wrote stdout: ${firstLine(r.stdout)}`);
    if (!r.stderr.startsWith(`${name}: `)) problems.push(`stderr does not start with '${name}: '`);
    return [...problems, ...ran.map((cmd) => `ran ${cmd}`)];
  });
}
