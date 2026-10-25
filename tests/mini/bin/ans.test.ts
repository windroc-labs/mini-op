import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../../lib/sandbox.ts";
import { events, fakeTerminal, sleeps, typed, type TerminalScene } from "../../lib/terminal.ts";
import { Jxa } from "../../lib/jxa.ts";

const ANS = path.join(REPO, "mini/bin/ans");
const MARKED =
  /^\{ (?<cmd>[\s\S]*)\n\}; printf '%s\\n' \$\? > (?<m>\S+)\.tmp && mv -f \k<m>\.tmp \k<m>$/;

async function ans(
  t: Parameters<typeof Sandbox.create>[0],
  text: string,
  args: string[] = [],
  scene: TerminalScene = {},
) {
  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb, scene);
  const r = await sb.run(["zsh", ANS, ...args], { input: text, timeoutMs: 30000 });
  return { sb, r };
}

function marked(sb: Sandbox): { cmd: string; marker: string } {
  const match = MARKED.exec(typed(sb) ?? "");
  assert.ok(match?.groups, typed(sb));
  return { cmd: match.groups.cmd ?? "", marker: match.groups.m ?? "" };
}

// An osascript call that runs out of time: SIGALRM ends it as with_timeout's timer would.
const HANGS = "kill -ALRM $PPID";

const done = (sb: Sandbox) => fs.readdirSync(path.join(sb.home, "apm/state/done")).sort();
const outLines = (stdout: string) => stdout.split("\n").slice(0, -1);

test("a fast command ends the wait without sleeping", async (t) => {
  const { sb, r } = await ans(t, "echo hi\n", ["120"]);
  assert.equal(r.code, 0, r.stderr);
  const { cmd, marker } = marked(sb);
  assert.equal(cmd, "echo hi");
  assert.equal(path.dirname(marker), path.join(sb.home, "apm/state/done"));
  const id = path.basename(marker);
  assert.match(id, /^\d+-\d+-\d+$/);
  assert.deepEqual(sleeps(sb), []);
  assert.deepEqual(outLines(r.stdout).slice(-2), ["mini ~ % ", `${id} exited 0`]);
  assert.ok(outLines(r.stdout).includes("hi"));
  assert.deepEqual(done(sb), []);
  assert.deepEqual(
    events(sb).filter((e) => e !== "history"),
    ["activate", "type", "bottom", "contents", "bottom"],
  );
});

test("a command ending in blank lines", async (t) => {
  const { r } = await ans(t, "printf 'Projects\\nNew\\n\\n\\nArtifacts\\n\\n\\n'", ["120"]);
  assert.equal(r.code, 0, r.stderr);
  const lines = outLines(r.stdout);
  assert.deepEqual(lines.slice(-4, -1), ["New", "Artifacts", "mini ~ % "]);
  assert.match(lines.at(-1) ?? "", /^\d+-\d+-\d+ exited 0$/);
});

test("a non-zero exit code is printed and exits 1", async (t) => {
  const { sb, r } = await ans(t, "ls /nonexistent-offline-fixture | cat; (exit 7)", ["10"]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(outLines(r.stdout).at(-1) ?? "", /^\d+-\d+-\d+ exited 7$/);
  assert.deepEqual(done(sb), []);
});

test("quotes, pipes and operators stay inside the command", async (t) => {
  const cmd = `printf '%s\\n' "a;b" 'it'"'"'s' | tr a-z A-Z && echo "x && y | z" ; false || echo 'ok $HOME'`;
  const { sb, r } = await ans(t, cmd, ["10"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(marked(sb).cmd, cmd);
  for (const line of ["A;B", "IT'S", "x && y | z", "ok $HOME"]) {
    assert.ok(outLines(r.stdout).includes(line), line);
  }
});

test("the closing brace on its own line keeps semicolons, comments and heredocs working", async (t) => {
  const cases: [string, string, string[], number][] = [
    ["echo hi;", "echo hi;", ["hi"], 0],
    ["echo hi # note", "echo hi # note", ["hi"], 0],
    ["cat <<EOF\nhi\nEOF\n", "cat <<EOF\nhi\nEOF", ["hi"], 0],
    [
      "find /dev/null -prune -exec echo {} \\;",
      "find /dev/null -prune -exec echo {} \\;",
      ["/dev/null"],
      0,
    ],
    ["echo a\necho b\n(exit 3)\n\n", "echo a\necho b\n(exit 3)", ["a", "b"], 3],
  ];
  for (const [text, cmd, out, rc] of cases) {
    const { sb, r } = await ans(t, text, ["10"]);
    assert.equal(r.code, rc === 0 ? 0 : 1, `${text}: ${r.stderr} ${r.stdout}`);
    const { marker } = marked(sb);
    assert.equal(
      typed(sb),
      `{ ${cmd}\n}; printf '%s\\n' $? > ${marker}.tmp && mv -f ${marker}.tmp ${marker}`,
    );
    for (const line of out) assert.ok(outLines(r.stdout).includes(line), `${text}: ${line}`);
    assert.equal(outLines(r.stdout).at(-1), `${path.basename(marker)} exited ${rc}`);
    assert.deepEqual(done(sb), []);
  }
});

test("a command still running times out and names its id", async (t) => {
  const { sb, r } = await ans(t, "install-test", ["2"], { runs: false });
  assert.equal(r.code, 124);
  const id = path.basename(marked(sb).marker);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.equal(
    r.stderr,
    `termwait: still running: ${id} (after 2 s); keep waiting with termwait <secs> --after ${id}\n`,
  );
});

test("--to returns the idle signal after a hidden answer with no screen echo", async (t) => {
  const { sb, r } = await ans(t, "answer\n", ["300", "--to", "1761200000-4242-17"], {
    runs: false,
    lands: false,
  });
  assert.equal(r.code, 75, r.stderr);
  assert.equal(typed(sb), "answer\n");
  assert.deepEqual(sleeps(sb), ["1", "1", "1"]);
  assert.match(r.stderr, /look now.*not finished/);
});

test("--to empty answers still press Return in the real keys program with fake JXA", async (t) => {
  for (const input of ["", "\n", "\r\n"]) {
    const { sb, r } = await ans(t, input, ["30", "--to", "1761200000-4242-17"], { runs: false });
    assert.equal(r.code, 75, r.stderr);
    const call = sb.calls("osascript").find((c) => c.program === "keys.js");
    assert.ok(call);
    const keys = Jxa.source("keys", { stdin: call.stdin, front: "Terminal" });
    const result = keys.osascript(call.argv.slice(3));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(keys.events, [{ type: "keyCode", code: 36 }]);
  }
});

test("an answer to a running command is typed as is and waits for it", async (t) => {
  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb, { runs: false });
  const id = "1761200000-4242-17";
  const marker = path.join(sb.home, "apm/state/done", id);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, "0\n");
  const r = await sb.run(["zsh", ANS, "300", "--to", id], { input: "y\n", timeoutMs: 30000 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(typed(sb), "y\n");
  assert.ok(r.stdout.endsWith(`${id} exited 0\n`), r.stdout);
  assert.ok(!fs.existsSync(marker));
});

test("refuses when Terminal is not frontmost and types nothing", async (t) => {
  const { sb, r } = await ans(t, "echo hi", [], { front: "Finder" });
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "terminal: Terminal not frontmost (Finder)\nans: Terminal not frontmost; typed nothing\n",
  );
  assert.deepEqual(events(sb), ["activate"]);
  assert.equal(typed(sb), undefined);
});

const NOT_LANDED = "ans: timed out after 5 s: typed text did not land; not waiting\n";

test("text that never lands exits 124 timed out", async (t) => {
  const { sb, r } = await ans(t, "echo hi", [], { lands: false });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, NOT_LANDED);
  const all = events(sb);
  assert.deepEqual(all.slice(all.indexOf("type") + 1), Array(10).fill("history"));
  assert.deepEqual(sleeps(sb), Array(9).fill("0.5"));
  assert.equal(r.stdout, "");
});

// Terminal answers history once (the before read), then every later read fails or hangs: the
// typed command may run, so ans neither waits nor says it did not land, and names its id: timed out
// when every read failed fast, killed when one hung.
test("landing reads that all fail or hang exit 124 and name the typed command", async (t) => {
  for (const [after, line] of [
    ["exit 1", "ans: timed out after 5 s: cannot read Terminal"],
    [HANGS, "ans: killed after 5 s: reading Terminal"],
  ] as const) {
    const sb = await Sandbox.create(t);
    sb.mini();
    sb.fake("osascript", [
      { program: "terminal.js", args: ["activate"], stdout: "Terminal\n" },
      {
        program: "terminal.js",
        args: ["history"],
        shell: `[[ -e $FAKE_DIR/typed ]] && { ${after}; }; print 'mini ~ % '`,
      },
      { program: "keys.js", shell: 'cat > "$FAKE_DIR/typed"' },
    ]);
    sb.fake("sleep", [{ ignoresStdin: true }]);
    const r = await sb.run(["zsh", ANS, "5"], { input: "echo hi" });
    assert.equal(r.code, 124, after);
    const id = path.basename(marked(sb).marker);
    assert.equal(
      r.stderr,
      `${line}; ${id} was typed: termwait <secs> --after ${id} waits for it\n`,
      after,
    );
    assert.equal(r.stdout, "", after);
    const programs = sb.calls("osascript").map((c) => `${c.program} ${c.argv.at(-1)}`);
    assert.deepEqual(programs.slice(2), [
      "keys.js --enter",
      ...Array<string>(10).fill("terminal.js history"),
    ]);
    assert.equal(sb.calls("sleep").length, 9, after);
  }
});

// One of the landing reads answers, unchanged, and the others fail: the text did not land.
test("a landing check that reads the scrollback unchanged once exits 124 timed out", async (t) => {
  const sb = await Sandbox.create(t);
  sb.mini();
  const read = `print x >> "$FAKE_DIR/reads"; (( $(wc -l < "$FAKE_DIR/reads") == 4 )) || exit 1`;
  sb.fake("osascript", [
    { program: "terminal.js", args: ["activate"], stdout: "Terminal\n" },
    {
      program: "terminal.js",
      args: ["history"],
      shell: `[[ -e $FAKE_DIR/typed ]] && { ${read}; }; print 'mini ~ % '`,
    },
    { program: "keys.js", shell: 'cat > "$FAKE_DIR/typed"' },
  ]);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const r = await sb.run(["zsh", ANS, "5"], { input: "echo hi" });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, NOT_LANDED);
  assert.equal(r.stdout, "");
  assert.equal(sb.calls("osascript").filter((c) => c.argv.at(-1) === "history").length, 11);
});

// Each Terminal call runs under with_timeout: a hung one exits 124 with its killed line.
test("a hung Terminal call exits 124 killed", async (t) => {
  const cases: [string, string[], string][] = [
    ["activate", ["activate"], "ans: killed after 5 s: activating Terminal; typed nothing"],
    ["history", ["history"], "ans: killed after 5 s: reading Terminal; typed nothing"],
    ["keys", [], "ans: killed after 15 s: typing"],
  ];
  for (const [name, args, line] of cases) {
    const sb = await Sandbox.create(t);
    sb.mini();
    fakeTerminal(sb);
    const program = name === "keys" ? "keys.js" : "terminal.js";
    sb.fake("osascript", [
      { program, args, shell: HANGS },
      { program: "terminal.js", args: ["activate"], stdout: "Terminal\n" },
      { program: "terminal.js", args: ["history"], stdout: "mini ~ % \n" },
    ]);
    const r = await sb.run(["zsh", ANS, "5"], { input: "echo hi" });
    assert.equal(r.code, 124, name);
    assert.equal(r.stderr, `${line}\n`, name);
    assert.equal(r.stdout, "", name);
    assert.ok(
      !sb.calls("osascript").some((c) => c.program === "terminal.js" && c.argv.at(-1) === "bottom"),
    );
  }
});

// The first scroll comes before termwait: 124 naming the typed command. The last one comes after
// it: a note, and the command's exit.
test("a hung scroll before termwait exits 124 killed; after it, the command's exit", async (t) => {
  for (const nth of [1, 2]) {
    const sb = await Sandbox.create(t);
    sb.mini();
    fakeTerminal(sb);
    const rules = JSON.parse(fs.readFileSync(path.join(sb.dir, "fakes/osascript.json"), "utf8"));
    // The nth bottom call hangs; the ones before it answer.
    const bottom = `print bottom >> "$FAKE_DIR/events"; (( $(grep -c bottom "$FAKE_DIR/events") < ${nth} )) || ${HANGS}`;
    sb.fake("osascript", [{ program: "terminal.js", args: ["bottom"], shell: bottom }, ...rules]);
    const r = await sb.run(["zsh", ANS, "5"], { input: "echo hi", timeoutMs: 30000 });
    assert.equal(r.code, nth === 1 ? 124 : 0, String(nth));
    const id = path.basename(marked(sb).marker);
    const line =
      nth === 1
        ? `ans: killed after 5 s: scrolling Terminal; ${id} was typed: termwait <secs> --after ${id} waits for it`
        : `ans: note: killed after 5 s: scrolling Terminal after ${id} ended`;
    assert.equal(r.stderr, `${line}\n`, String(nth));
    assert.equal(r.stdout.includes(`${id} exited 0`), nth === 2, String(nth));
  }
});

test("an unreadable Terminal or marker dir refuses before typing", async (t) => {
  const unreadable = await Sandbox.create(t);
  unreadable.mini();
  fakeTerminal(unreadable);
  unreadable.fake("osascript", [
    { program: "terminal.js", args: ["activate"], stdout: "Terminal\n" },
    { program: "terminal.js", args: ["history"], exit: 1 },
  ]);
  const r = await unreadable.run(["zsh", ANS, "5"], { input: "echo hi" });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, "ans: cannot read Terminal; typed nothing\n");
  assert.equal(typed(unreadable), undefined);

  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb);
  fs.writeFileSync(path.join(sb.home, "apm/state"), "");
  const blocked = await sb.run(["zsh", ANS, "5"], { input: "echo hi" });
  assert.equal(blocked.code, 1);
  assert.equal(blocked.stderr, "ans: cannot make ~/apm/state/done; typed nothing\n");
  assert.equal(typed(sb), undefined);
});

test("a typing failure stops before waiting", async (t) => {
  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb);
  sb.fake("osascript", [
    { program: "terminal.js", args: ["activate"], stdout: "Terminal\n" },
    { program: "terminal.js", args: ["history"], stdout: "mini ~ % \n" },
    {
      program: "keys.js",
      stderr: "keys: Terminal not frontmost (Finder); typed nothing\n",
      exit: 1,
    },
  ]);
  const r = await sb.run(["zsh", ANS, "5"], { input: "echo hi" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /ans: typing failed; not waiting\n$/);
  assert.deepEqual(sleeps(sb), []);
});

test("bad arguments and empty commands are refused before typing", async (t) => {
  const cases: [string, string[]][] = [
    ["echo hi", ["--to", "../x"]],
    ["echo hi", ["3", "extra"]],
    ["echo hi", ["--no-such-option"]],
    ["echo hi", ["-h", "x"]],
    ["y", ["--to"]],
    ["\n", []],
    ["  ", ["5"]],
  ];
  for (const [text, args] of cases) {
    const { sb, r } = await ans(t, text, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr, /^ans: usage: ans \[secs\] \[--to <id>\]/, args.join(" "));
    assert.equal(r.stdout, "");
    assert.equal(typed(sb), undefined);
  }
});

test("-h prints the usage to stdout and calls nothing", async (t) => {
  const sb = await Sandbox.create(t);
  sb.mini();
  fakeTerminal(sb);
  const r = await sb.run(["zsh", ANS, "-h"], { input: "echo hi" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^ans \[secs\] \[--to <id>\] /);
  assert.match(r.stdout, /124/);
  assert.deepEqual(sb.calls(), []);
  assert.deepEqual(events(sb), []);
});
