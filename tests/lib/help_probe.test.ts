import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { helpProbe, optionProbe } from "./help_probe.ts";
import { isExecutable, testedFiles } from "./managed.ts";
import { loadPathBypass, loadSecrets } from "./registry.ts";
import { fromRoot } from "./repo.ts";
import { REPO, Sandbox } from "./sandbox.ts";
import { prependsPath } from "./path_bypass.ts";
import { Tripwire } from "./tripwire.ts";

type Hook = { after(fn: () => void): void };

// A checkout holding the registries the tripwire reads and the given scripts under ctl/; the
// caller makes it a git repo.
function tempRepo(t: Hook, scripts: Record<string, string>): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mini-op-repo-")));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, "tests/registry"), { recursive: true });
  fs.mkdirSync(path.join(repo, "ctl"));
  for (const name of ["secrets.json", "path-bypass.json"]) {
    fs.copyFileSync(
      path.join(REPO, "tests/registry", name),
      path.join(repo, "tests/registry", name),
    );
  }
  for (const [name, text] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(repo, "ctl", name), text, { mode: 0o755 });
  }
  return repo;
}

// A zsh script: `onHelp` runs for -h, `onOption` for any other -… argument, and otherwise it
// calls date.
function script(onHelp: string, onOption: string): string {
  return [
    "#!/usr/bin/env zsh",
    `if [[ $1 == -h ]]; then\n${onHelp}\nfi`,
    `if [[ $1 == -* ]]; then\n${onOption}\nfi`,
    "date",
    "",
  ].join("\n");
}

const help = (name: string) => `print -r -- '${name} [x]   does nothing'\nexit 0`;
const usage = (name: string) => `print -u2 -r -- '${name}: usage: ${name} [x]'\nexit 2`;

const SAMPLES: Record<string, [string, string]> = {
  clean: [help("clean"), usage("clean")],
  reads: [`read -r line\n${help("reads")}`, usage("reads")],
  date: [`date >/dev/null\n${help("date")}`, usage("date")],
  fake: [`ssh mini true\n${help("fake")}`, usage("fake")],
  home: [`: > $HOME/made\n${help("home")}`, usage("home")],
  repo: [`: > \${0:h}/made\n${help("repo")}`, usage("repo")],
  stderr: [`print -u2 -- warn\n${help("stderr")}`, usage("stderr")],
  name: ["print -r -- 'usage: name [x]'\nexit 0", usage("name")],
  fails: ["exit 1", usage("fails")],
  "opt-exit": [help("opt-exit"), "print -u2 -r -- 'opt-exit: usage: opt-exit'\nexit 1"],
  "opt-out": [help("opt-out"), `print -r -- 'opt-out: usage: opt-out'\n${usage("opt-out")}`],
  "opt-prefix": [help("opt-prefix"), "print -u2 -r -- 'usage: opt-prefix'\nexit 2"],
  "opt-date": [help("opt-date"), `date >/dev/null\n${usage("opt-date")}`],
};

async function probes(t: Hook) {
  const scripts = Object.fromEntries(
    Object.entries(SAMPLES).map(([name, [onHelp, onOption]]) => [name, script(onHelp, onOption)]),
  );
  const repo = tempRepo(t, scripts);
  const sb = await Sandbox.create(t, { repo });
  await sb.run(["git", "init", "-q"], { cwd: repo });
  return {
    help: (name: string) => helpProbe(sb, `ctl/${name}`, { repo }),
    option: (name: string) => optionProbe(sb, `ctl/${name}`, { repo }),
  };
}

test("a clean script passes both probes", async (t) => {
  const probe = await probes(t);
  assert.deepEqual(await probe.help("clean"), []);
  assert.deepEqual(await probe.option("clean"), []);
});

test("the probe catches a -h that reads stdin / calls a command / writes a file / writes stderr", async (t) => {
  const probe = await probes(t);
  const cases: [string, string[]][] = [
    ["reads", ["ctl/reads -h: read stdin"]],
    ["date", ["ctl/date -h: ran date"]],
    ["fake", ["ctl/fake -h: ran ssh mini true"]],
    ["home", ["ctl/home -h: created home/made"]],
    ["repo", ["ctl/repo -h: changed the checkout: ?? ctl/made"]],
    ["stderr", ["ctl/stderr -h: wrote stderr: warn"]],
    ["name", ["ctl/name -h: stdout does not start with 'name '"]],
    ["fails", ["ctl/fails -h: exited 1, not 0", "ctl/fails -h: stdout is empty"]],
  ];
  for (const [name, expected] of cases) assert.deepEqual(await probe.help(name), expected, name);
});

test("the option probe catches a wrong exit, stdout, an unprefixed stderr and a command", async (t) => {
  const probe = await probes(t);
  const cases: [string, string[]][] = [
    ["opt-exit", ["ctl/opt-exit --no-such-option: exited 1, not 2"]],
    ["opt-out", ["ctl/opt-out --no-such-option: wrote stdout: opt-out: usage: opt-out"]],
    ["opt-prefix", ["ctl/opt-prefix --no-such-option: stderr does not start with 'opt-prefix: '"]],
    ["opt-date", ["ctl/opt-date --no-such-option: ran date"]],
  ];
  for (const [name, expected] of cases) {
    assert.deepEqual(await probe.option(name), expected, name);
  }
});

// Every script of this checkout (FR-52), split into those the probe runs and those the tripwire
// refuses to run (D11).
function repoScripts() {
  const view = fromRoot(REPO);
  const tripwire = new Tripwire(REPO);
  const scripts = testedFiles(view).filter((file) => isExecutable(file, view.read(file)));
  const refused = (file: string) => tripwire.fileTrips(file, view.read(file)) !== undefined;
  return {
    view,
    probed: scripts.filter((file) => !refused(file)),
    skipped: scripts.filter(refused),
  };
}

test("the probe skips exactly the tripwire's files", () => {
  const { view, probed, skipped } = repoScripts();
  const scripts = new Set([...probed, ...skipped]);
  const readers = loadSecrets(view.read)
    .literal.filter((entry) => entry.reads)
    .map((entry) => entry.file);
  const bypassers = loadPathBypass(view.read)
    .map((entry) => entry.file)
    .filter((file) => prependsPath(view.read(file)));
  const expected = [...bypassers, ...readers];
  assert.deepEqual(skipped.sort(), expected.filter((file) => scripts.has(file)).sort());
  assert.ok(probed.length > 0);
  assert.ok(probed.includes("mini/bin/o"));
});

test("every script's -h prints its usage and does nothing else", async (t) => {
  const sb = await Sandbox.create(t);
  const problems: string[] = [];
  for (const file of repoScripts().probed) problems.push(...(await helpProbe(sb, file)));
  assert.deepEqual(problems, []);
});

test("every script rejects an unknown option", async (t) => {
  const sb = await Sandbox.create(t);
  const problems: string[] = [];
  for (const file of repoScripts().probed) problems.push(...(await optionProbe(sb, file)));
  assert.deepEqual(problems, []);
});
