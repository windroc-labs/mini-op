import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";
import { fakeTerminal, SLEEP, typed, type TerminalScene } from "../../lib/terminal.ts";

const VISIBLE = path.join(REPO, "mini/bin/visible");
const ID = "1761200000-4242-17";
const jobs = (sb: Sandbox) => path.join(sb.home, "apm/state/visible");
const job = (sb: Sandbox) => path.join(jobs(sb), ID);

async function setup(t: Parameters<typeof Sandbox.create>[0], scene: TerminalScene = {}) {
  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb, scene);
  return sb;
}

test("visible returns complete separate streams, preserves blank lines and shows output", async (t) => {
  const sb = await setup(t);
  const output = Array.from({ length: 80 }, (_, i) => `line ${i}\n\n`).join("");
  const r = await sb.run(["zsh", VISIBLE, "0"], {
    input: `printf '%s' '${output}'; printf 'error\n\n' >&2`,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, output);
  assert.equal(r.stderr, "error\n\n");
  const screen = fs.readFileSync(path.join(sb.dir, "screen"), "utf8");
  assert.ok(screen.includes(output));
  assert.ok(screen.includes("error\n\n"));
  assert.match(typed(sb) ?? "", /visible --execute \d+-\d+-\d+/);
  assert.ok(!(typed(sb) ?? "").includes("line 79"));
  assert.deepEqual(fs.readdirSync(jobs(sb)), []);
  assert.ok(!sb.calls("osascript").some((call) => call.program === "dialogs.js"));
});

test("exit and syntax errors are captured without losing completion", async (t) => {
  for (const [command, code] of [
    ["exit 1", 1],
    ["printf out; printf err >&2; exit 7", 7],
    ["exit 124", 124],
    ["exit 255", 255],
    ["if", 1],
  ] as const) {
    const sb = await setup(t);
    const r = await sb.run(["zsh", VISIBLE, "0"], { input: command });
    assert.equal(r.code, code, r.stderr);
    assert.ok(!r.stderr.includes("dialogs"));
    assert.deepEqual(fs.readdirSync(jobs(sb)), []);
  }
});

const notDialogs = (sb: Sandbox) =>
  sb.calls("osascript").filter((call) => call.program !== "dialogs.js").length;

test("timeout preserves a private job; collect never executes it again", async (t) => {
  const sb = await setup(t, { runs: false, dialogs: "" });
  const r = await sb.run(["zsh", VISIBLE, "0"], { input: "printf once" });
  assert.equal(r.code, 124, r.stderr);
  const [id] = fs.readdirSync(jobs(sb));
  assert.match(id ?? "", /^\d+-\d+-\d+$/);
  assert.match(r.stderr, new RegExp(`mini exec --collect ${id}`));
  const dir = path.join(jobs(sb), id!);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, "command")).mode & 0o777, 0o600);
  const before = notDialogs(sb);
  const pending = await sb.run(["zsh", VISIBLE, "--collect", id!]);
  assert.equal(pending.code, 124);
  assert.equal(notDialogs(sb), before);
  fs.writeFileSync(path.join(dir, "stdout"), "once\n");
  fs.writeFileSync(path.join(dir, "stderr"), "warning");
  fs.writeFileSync(path.join(dir, "rc"), "7\n");
  const collected = await sb.run(["zsh", VISIBLE, "--collect", id!]);
  assert.equal(collected.code, 7, collected.stderr);
  assert.equal(collected.stdout, "once\n");
  assert.equal(collected.stderr, "warning");
  assert.equal(notDialogs(sb), before);
  assert.ok(!fs.existsSync(dir));
});

test("a 124 prints the mini's dialogs after the still-running line", async (t) => {
  const listed = "SecurityAgent |  | Always Allow, Deny, Allow\nFinder | x | OK\n";
  for (const [dialogs, shown] of [
    [listed, `visible: dialogs on the mini:\n${listed}`],
    ["", "visible: no dialogs on the mini\n"],
    [{ exit: 1 }, "visible: cannot list dialogs\n"],
    [{ shell: "kill -ALRM $PPID" }, "visible: cannot list dialogs\n"],
  ] as const) {
    const sb = await setup(t, { runs: false, dialogs });
    const r = await sb.run(["zsh", VISIBLE, "0"], { input: "printf once" });
    assert.equal(r.code, 124, r.stderr);
    const [id] = fs.readdirSync(jobs(sb));
    const still = `visible: still running or launch uncertain: ${id}; recover with mini exec --collect ${id}\n`;
    assert.ok(r.stderr.endsWith(still + shown), r.stderr);
    const pending = await sb.run(["zsh", VISIBLE, "--collect", id!]);
    assert.equal(pending.code, 124);
    assert.equal(pending.stderr, still + shown);
  }
});

test("frontmost refusal never runs the command", async (t) => {
  const sb = await setup(t, { front: "Finder" });
  const r = await sb.run(["zsh", VISIBLE, "0"], { input: "echo no" });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /Terminal not frontmost/);
  assert.equal(typed(sb), undefined);
});

test("exec keeps waiting after an idle signal and returns only the final captured streams", async (t) => {
  const sb = await setup(t, { runs: false });
  sb.fake("sleep", [
    {
      shell: `${SLEEP}\n[[ $(cat $FAKE_DIR/clock) == 5 ]] && zsh -f -c "$(cat $FAKE_DIR/typed)" > "$FAKE_DIR/screen" 2>&1; exit 0`,
    },
  ]);
  const r = await sb.run(["zsh", VISIBLE, "30"], { input: "printf completed; printf warning >&2" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "completed");
  assert.equal(r.stderr, "warning");
});

test("collect refuses missing, damaged or incomplete results and preserves evidence", async (t) => {
  const sb = await setup(t);
  const missing = await sb.run(["zsh", VISIBLE, "--collect", ID]);
  assert.equal(missing.code, 1);
  fs.mkdirSync(job(sb), { recursive: true });
  for (const rc of ["", "bad", "256", "0\nextra"]) {
    fs.writeFileSync(path.join(job(sb), "rc"), rc);
    const r = await sb.run(["zsh", VISIBLE, "--collect", ID]);
    assert.equal(r.code, 1, rc);
    assert.ok(fs.existsSync(job(sb)));
  }
  fs.writeFileSync(path.join(job(sb), "rc"), "0\n");
  const r = await sb.run(["zsh", VISIBLE, "--collect", ID]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /invalid result/);
});

test("execute is single-use even before completion", async (t) => {
  const sb = await setup(t);
  fs.mkdirSync(job(sb), { recursive: true });
  fs.writeFileSync(path.join(job(sb), "command"), "printf once");
  const first = await sb.run(["zsh", VISIBLE, "--execute", ID]);
  assert.equal(first.code, 0, first.stderr);
  const twice = await sb.run(["zsh", VISIBLE, "--execute", ID]);
  assert.equal(twice.code, 1);
  assert.equal(twice.stdout, "");
});

test("usage and empty input are refused, help has no side effects", async (t) => {
  const sb = await setup(t);
  for (const args of [["--collect", "../x"], ["--execute"], ["--bad"], ["1", "x"], []]) {
    const r = await sb.run(["zsh", VISIBLE, ...args], { input: " \n" });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^visible: usage:/);
  }
  const help = await sb.run(["zsh", VISIBLE, "-h"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^visible /);
  assert.deepEqual(sb.calls(), []);
});
