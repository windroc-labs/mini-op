import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../../lib/sandbox.ts";
import { events, fakeTerminal, SLEEP, sleeps } from "../../lib/terminal.ts";

const TERMWAIT = path.join(REPO, "mini/bin/termwait");
const ID = "1761200000-4242-17";
// With a "finish" file holding "<n> <rc>", the command ends (marker via tmp + mv) during the n-th
// one-second sleep.
const FINISHING_SLEEP = `${SLEEP}
[[ -e $FAKE_DIR/finish ]] || exit 0
read at rc < "$FAKE_DIR/finish"
(( $(wc -l < "$FAKE_DIR/sleeps") == at )) || exit 0
print -r -- "$rc" > "$HOME/apm/state/done/$ID.tmp" && mv "$HOME/apm/state/done/$ID.tmp" "$HOME/apm/state/done/$ID"`;

async function sandbox(t: Parameters<typeof Sandbox.create>[0]) {
  const sb = await Sandbox.create(t);
  sb.mini();
  const done = path.join(sb.home, "apm/state/done");
  fs.mkdirSync(done, { recursive: true });
  const wait = async (
    args: string[],
    opts: { screen?: string; finish?: string; read?: FakeRule } = {},
  ) => {
    fakeTerminal(sb, { screen: opts.screen ?? "Dots-Mac-mini acp-exp % " }, FINISHING_SLEEP);
    if (opts.read)
      sb.fake("osascript", [{ program: "terminal.js", args: ["contents"], ...opts.read }]);
    if (opts.finish !== undefined) fs.writeFileSync(path.join(sb.dir, "finish"), opts.finish);
    return sb.run(["zsh", TERMWAIT, ...args], { env: { ID } });
  };
  return { sb, done, wait };
}

test("a marker written before the wait starts ends it at once", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["120", "--after", ID], { screen: "ok\nmini ~ % " });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sleeps(sb), []);
  assert.equal(r.stdout, `ok\nmini ~ % \n${ID} exited 0\n`);
  assert.ok(!fs.existsSync(path.join(done, ID)));
  assert.deepEqual(events(sb), ["contents"]);
});

test("a command ending in blank lines ends when its marker appears", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const screen = "Projects\nNew\n\n\nArtifacts\n\n\n\nDots-Mac-mini acp-exp % \n\n\n";
  const r = await wait(["120", "--after", ID], { screen, finish: "2 0" });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.deepEqual(r.stdout.split("\n").slice(0, -1), [
    "Projects",
    "New",
    "Artifacts",
    "Dots-Mac-mini acp-exp % ",
    `${ID} exited 0`,
  ]);
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a non-zero exit code is printed and exits 1", async (t) => {
  const { done, wait } = await sandbox(t);
  const r = await wait(["5", "--after", ID], { finish: "1 3" });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`${ID} exited 3\n`));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a timeout shorter than the idle threshold exits 124 and names the id", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["2", "--after", ID], { screen: "Write it? [y/N] " });
  assert.equal(r.code, 124);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.equal(r.stdout, "Write it? [y/N] \n");
  assert.equal(
    r.stderr,
    `termwait: still running: ${ID} (after 2 s); keep waiting with termwait <secs> --after ${ID}\n`,
  );
});

test("three unchanged seconds returns a look-now signal without claiming completion", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const r = await wait(["300", "--after", ID], { screen: "no recognizable prompt here" });
  assert.equal(r.code, 75, r.stderr);
  assert.deepEqual(sleeps(sb), ["1", "1", "1"]);
  assert.match(r.stderr, /look now.*not finished/);
  assert.ok(!r.stdout.includes("exited"));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a completion marker wins over idle at the same instant", async (t) => {
  const { done, wait } = await sandbox(t);
  const r = await wait(["300", "--after", ID], { finish: "3 0" });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.endsWith(`${ID} exited 0\n`));
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("changing contents time out even if the text looks like an input prompt", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["5", "--after", ID], {
    read: {
      shell:
        'n=$(( $(cat $FAKE_DIR/reads 2>/dev/null || print 0) + 1 )); print $n > $FAKE_DIR/reads; print "Write it? [y/N] $n"',
    },
  });
  assert.equal(r.code, 124);
  assert.equal(sleeps(sb).length, 5);
});

test("failed or hung reads cannot establish idle", async (t) => {
  for (const shell of [
    "exit 1",
    "kill -ALRM $PPID",
    "n=$(( $(cat $FAKE_DIR/reads 2>/dev/null || print 0) + 1 )); print $n > $FAKE_DIR/reads; (( n % 2 )) || exit 1; print unchanged",
  ]) {
    const { wait } = await sandbox(t);
    const r = await wait(["5", "--after", ID], { read: { shell } });
    assert.equal(r.code, 124, r.stderr);
    assert.ok(!r.stderr.includes("look now"));
  }
});

test("a zero-second wait checks the marker once", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  assert.equal((await wait(["0", "--after", ID])).code, 124);
  assert.deepEqual(sleeps(sb), []);
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["0", "--after", ID])).code, 0);
});

test("a later wait reads the marker a timed-out one left", async (t) => {
  const { done, wait } = await sandbox(t);
  assert.equal((await wait(["1", "--after", ID])).code, 124);
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["1", "--after", ID]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("a marker holding no exit code fails", async (t) => {
  const { done, wait } = await sandbox(t);
  fs.writeFileSync(path.join(done, ID), "oops\n");
  const r = await wait(["1", "--after", ID]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `termwait: ${ID} marker holds no exit code\n`);
});

test("deletes only its own marker", async (t) => {
  const { done, wait } = await sandbox(t);
  const other = "1761200000-4242-18";
  fs.writeFileSync(path.join(done, other), "0\n");
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["1", "--after", ID])).code, 0);
  assert.deepEqual(fs.readdirSync(done), [other]);
});

test("removes only stale marker files in the marker dir", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const old = Date.now() / 1000 - 2 * 86400;
  const stale = [path.join(done, "1761000000-1-1"), path.join(done, "1761000000-1-2.tmp")];
  const kept = [
    path.join(done, "1761200000-1-3"),
    path.join(done, "1761200000-1-4.tmp"),
    path.join(done, "notes"),
    path.join(done, "1761000000-1-5.log"),
    path.join(done, "sub", "1761000000-1-6"),
    path.join(sb.home, "apm", "1761000000-1-7"),
  ];
  fs.mkdirSync(path.join(done, "sub"));
  for (const file of [...stale, ...kept]) fs.writeFileSync(file, "0\n");
  for (const file of [...stale, ...kept.slice(2)]) fs.utimesSync(file, old, old);
  fs.writeFileSync(path.join(done, ID), "0\n");
  assert.equal((await wait(["1", "--after", ID])).code, 0);
  for (const file of stale) assert.ok(!fs.existsSync(file), file);
  for (const file of kept) assert.ok(fs.existsSync(file), file);
});

test("redaction and the tail are kept", async (t) => {
  const { done, wait } = await sandbox(t);
  const tokens = ["sk-ant-", "lin_api_", "ghp_", "gho_", "github_pat_"].map(
    (prefix) => `${prefix}offline_fixture`,
  );
  const screen = [
    ...Array.from({ length: 30 }, (_, n) => `line ${n}`),
    "Your OAuth token",
    "offline-oauth-fixture",
    "Store this token safely",
    tokens.join(" "),
    "mini ~ % ",
  ].join("\n");
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["3", "--after", ID], { screen });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes("offline-oauth-fixture"));
  for (const token of tokens) assert.ok(!r.stdout.includes(token), token);
  assert.ok(r.stdout.includes("<token hidden>"));
  assert.ok(r.stdout.split("\n").length - 1 <= 26);
});

test("invalid options fail before touching anything", async (t) => {
  const { sb, done, wait } = await sandbox(t);
  const stale = path.join(done, "1761000000-1-1");
  fs.writeFileSync(stale, "0\n");
  const old = Date.now() / 1000 - 2 * 86400;
  fs.utimesSync(stale, old, old);
  for (const args of [
    ["--after", ID],
    ["3"],
    ["3", "--after"],
    ["3", "--after", "../x"],
    ["3", "--after", `48:${"a".repeat(64)}`],
    ["--baseline"],
    ["3", "--again"],
    ["oops"],
    ["--no-such-option"],
    ["-h", "x"],
    ["3", "--after", ID, "--until-input", "--until-input"],
    ["3", "--until-input", "--after", ID],
    ["--until-input", "3", "--after", ID],
    ["3", "--after", ID, "--until"],
  ]) {
    const r = await wait(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(
      r.stderr,
      "termwait: usage: termwait <secs> --after <id> [--until-input]\n",
      args.join(" "),
    );
    assert.equal(r.stdout, "");
    assert.deepEqual(events(sb), []);
    assert.ok(fs.existsSync(stale));
  }
});

test("every secret pattern on screen is redacted (FR-34)", async (t) => {
  const { done, wait } = await sandbox(t);
  const tokens = ["ghs_", "ghu_", "ghr_", "ghp_", "lin_api_", "sk-ant-", "github_pat_"].map(
    (prefix) => prefix + "Hidden0" + prefix.length,
  );
  const key = [
    "-----BEGIN " + "RSA PRIVATE KEY-----",
    "MIIEkeybody",
    "-----END " + "RSA PRIVATE KEY-----",
  ];
  fs.writeFileSync(path.join(done, ID), "0\n");
  const screen = ["start", ...tokens, ...key, "mini ~ % "].join("\n") + "\n";
  const r = await wait(["1", "--after", ID], { screen });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes("Hidden0"), r.stdout);
  assert.ok(!r.stdout.includes("keybody"), r.stdout);
  assert.equal(r.stdout.split("<redacted>").length - 1, tokens.length);
  assert.ok(r.stdout.includes("<redacted private key>\n"));
});

test("-h prints the usage to stdout and touches nothing", async (t) => {
  const { sb, wait } = await sandbox(t);
  const r = await wait(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^termwait <secs> --after <id> /);
  assert.match(r.stdout, /124/);
  assert.deepEqual(sb.calls(), []);
});

// --until-input scenes: the screen, the front tab's tty, its stty modes and the dialogs listing.
// A file named <name>.<n> wins over <name> once n seconds have passed.
const AT = (name: string) =>
  `f=$FAKE_DIR/${name}.$(( $(cat "$FAKE_DIR/clock") - $(cat "$FAKE_DIR/start") )); [[ -e $f ]] || f=$FAKE_DIR/${name}`;
const TTY = "/dev/ttys001";
const NO_ECHO = "lflags: icanon isig iexten -echo echoe echok\n";
type Scene = {
  screen?: string;
  stty?: string | null;
  tty?: string | null;
  tmux?: string;
  // "FAIL" at a second makes that second's read fail.
  dialogs?: Record<string, string> | null;
  finish?: string;
  // the last 3 nonblank lines ans --to recorded when it answered
  answered?: string;
  // seconds after which the screen changes to this text
  later?: [number, string];
};

async function inputSandbox(t: Parameters<typeof Sandbox.create>[0]) {
  const { sb, done } = await sandbox(t);
  const wait = async (args: string[], scene: Scene = {}) => {
    fakeTerminal(sb, { screen: scene.screen ?? "mini ~ % " }, FINISHING_SLEEP);
    for (const name of ["clock", "start"]) fs.writeFileSync(path.join(sb.dir, name), "0");
    if (scene.answered !== undefined) {
      fs.mkdirSync(path.join(sb.home, "apm/state/answered"), { recursive: true });
      fs.writeFileSync(path.join(sb.home, "apm/state/answered", ID), `${scene.answered}\n`);
    }
    if (scene.later)
      fs.writeFileSync(path.join(sb.dir, `screen.${scene.later[0]}`), scene.later[1]);
    if (scene.finish !== undefined) fs.writeFileSync(path.join(sb.dir, "finish"), scene.finish);
    for (const [at, text] of Object.entries(scene.dialogs ?? {}))
      fs.writeFileSync(path.join(sb.dir, at === "0" ? "dialogs" : `dialogs.${at}`), text);
    sb.fake("osascript", [
      {
        program: "terminal.js",
        args: ["contents"],
        shell: `${AT("screen")}; cat $f; print
[[ -e $FAKE_DIR/slow ]] && print $(( $(cat "$FAKE_DIR/clock") + 1 )) > "$FAKE_DIR/clock"; true`,
      },
      scene.tty === null
        ? { program: "terminal.js", args: ["tty"], exit: 1 }
        : { program: "terminal.js", args: ["tty"], stdout: `${scene.tty ?? TTY}\n` },
      scene.dialogs === null
        ? { program: "dialogs.js", exit: 1 }
        : {
            program: "dialogs.js",
            shell: `${AT("dialogs")}; [[ $(cat $f 2>/dev/null) != FAIL ]] || exit 1; cat $f 2>/dev/null; true`,
          },
    ]);
    sb.fake(
      "stty",
      scene.stty === null ? [{ exit: 1 }] : [{ argv: ["-a", "-f"], stdout: scene.stty ?? NO_ECHO }],
    );
    sb.fake("tmux", [
      scene.tmux === undefined
        ? { exit: 1, stderr: "no server running\n" }
        : { argv: ["display-message", "-c"], stdout: `${scene.tmux}\n` },
    ]);
    return sb.run(["zsh", TERMWAIT, ...args], { env: { ID } });
  };
  const sttyTtys = () => sb.calls("stty").map((call) => call.argv.at(-1));
  return { sb, done, wait, sttyTtys };
}

const PROMPT = `termwait: input: ${ID} at a prompt; answer with ans --to ${ID} --until-input\n`;
const PASSWORD = `termwait: input: ${ID} at a password prompt (no echo verified); answer with mini pw if the runbook expects it\n`;
const STILL = (secs: number) =>
  `termwait: still running: ${ID} (after ${secs} s); keep waiting with termwait <secs> --after ${ID}\n`;
const SA = "SecurityAgent |  | Always Allow, Deny, Allow";
const SA_EVENT = (line: string) =>
  `termwait: input: ${ID} waits on a SecurityAgent dialog (${line}); answer with mini pw --sa if the runbook expects it, then termwait <secs> --after ${ID} --until-input\n`;

test("--until-input: the marker wins over a prompt and a dialog in the same poll", async (t) => {
  const { done, wait } = await inputSandbox(t);
  fs.writeFileSync(path.join(done, ID), "0\n");
  const r = await wait(["30", "--after", ID, "--until-input"], {
    screen: "Write it? [y/N] ",
    dialogs: { "0": "Finder | x | OK\n", "1": `${SA}\n` },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `Write it? [y/N] \n${ID} exited 0\n`);
  assert.ok(!fs.existsSync(path.join(done, ID)));
});

test("--until-input: a marker written later ends the wait as without the flag", async (t) => {
  const { sb, done, wait } = await inputSandbox(t);
  const r = await wait(["30", "--after", ID, "--until-input"], { finish: "2 3" });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.endsWith(`${ID} exited 3\n`));
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.deepEqual(fs.readdirSync(done), []);
});

test("--until-input returns 75 at a question prompt", async (t) => {
  for (const screen of [
    "Write it? [y/N] ",
    "Continue? [Y/n]",
    "Overwrite [y/n]\n\n  \n",
    "Project name ?:",
  ]) {
    const { sb, done, wait } = await inputSandbox(t);
    const r = await wait(["30", "--after", ID, "--until-input"], { screen });
    assert.equal(r.code, 75, screen);
    assert.equal(r.stderr, PROMPT, screen);
    assert.deepEqual(sleeps(sb), [], screen);
    assert.ok(r.stdout.includes(screen.split("\n")[0] ?? ""), screen);
    assert.deepEqual(fs.readdirSync(done), []);
  }
});

test("--until-input: an answered prompt is no event", async (t) => {
  const { sb, wait } = await inputSandbox(t);
  const r = await wait(["3", "--after", ID, "--until-input"], { screen: "Write it? [y/N] y" });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, STILL(3));
  assert.equal(sleeps(sb).length, 3);
});

test("--until-input returns 75 only at a no-echo password prompt", async (t) => {
  for (const screen of [
    "Password:",
    "[sudo] password for dot: ",
    "Enter passphrase for key 'k':",
  ]) {
    const { sttyTtys, wait } = await inputSandbox(t);
    const r = await wait(["30", "--after", ID, "--until-input"], { screen });
    assert.equal(r.code, 75, screen);
    assert.equal(r.stderr, PASSWORD, screen);
    assert.deepEqual(sttyTtys(), [TTY]);
  }
  for (const scene of [
    { stty: "lflags: icanon isig iexten echo echoe\n" },
    { stty: "lflags: -icanon isig iexten -echo echoe\n" },
    { stty: null },
    { tty: null },
    { tty: "not a tty" },
  ]) {
    const { sb, wait } = await inputSandbox(t);
    const r = await wait(["3", "--after", ID, "--until-input"], { screen: "Password:", ...scene });
    assert.equal(r.code, 124, JSON.stringify(scene));
    assert.equal(r.stderr, STILL(3), JSON.stringify(scene));
    assert.equal(sleeps(sb).length, 3);
  }
});

test("--until-input: Password?: is a password prompt, never a question", async (t) => {
  const verified = await inputSandbox(t);
  const r = await verified.wait(["30", "--after", ID, "--until-input"], { screen: "Password?:" });
  assert.equal(r.code, 75);
  assert.equal(r.stderr, PASSWORD);
  const echoing = await inputSandbox(t);
  const e = await echoing.wait(["2", "--after", ID, "--until-input"], {
    screen: "Password?:",
    stty: "lflags: icanon echo\n",
  });
  assert.equal(e.code, 124);
  assert.equal(e.stderr, STILL(2));
});

test("--until-input checks the tmux pane's tty, not the client's", async (t) => {
  const { sb, sttyTtys, wait } = await inputSandbox(t);
  const r = await wait(["30", "--after", ID, "--until-input"], {
    screen: "Password:",
    tmux: "/dev/ttys009",
  });
  assert.equal(r.code, 75, r.stderr);
  assert.deepEqual(sttyTtys(), ["/dev/ttys009"]);
  assert.deepEqual(
    sb.calls("tmux").map((call) => call.argv),
    [["display-message", "-c", TTY, "-p", "#{pane_tty}"]],
  );
});

test("--until-input returns 75 on a SecurityAgent dialog", async (t) => {
  const { sb, done, wait } = await inputSandbox(t);
  const r = await wait(["30", "--after", ID, "--until-input"], {
    dialogs: { "0": "Finder | x | OK\n", "2": `Finder | x | OK\n${SA}\n` },
  });
  assert.equal(r.code, 75, r.stderr);
  assert.equal(r.stderr, SA_EVENT(SA));
  assert.deepEqual(sleeps(sb), ["1", "1"]);
  assert.deepEqual(fs.readdirSync(done), []);
});

test("--until-input: failed dialogs reads are no event and set no baseline", async (t) => {
  const failing = await inputSandbox(t);
  const r = await failing.wait(["3", "--after", ID, "--until-input"], { dialogs: null });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, STILL(3));
  // The first successful read (second 1) is the baseline, not the failed one at second 0.
  const { sb, wait } = await inputSandbox(t);
  const dialogs = Object.fromEntries([1, 2, 3, 4, 5].map((at) => [String(at), `${SA}\n`]));
  const late = await wait(["5", "--after", ID, "--until-input"], {
    dialogs: { "0": "FAIL", ...dialogs },
  });
  assert.equal(late.code, 124, late.stderr);
  assert.equal(late.stderr, STILL(5));
  assert.equal(sleeps(sb).length, 5);
});

test("--until-input: a dialog up at the start is reported only after 10 s", async (t) => {
  const short = await inputSandbox(t);
  const r = await short.wait(["5", "--after", ID, "--until-input"], {
    dialogs: { "0": `${SA}\n` },
  });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, STILL(5));
  const { sb, wait } = await inputSandbox(t);
  const lingering = await wait(["30", "--after", ID, "--until-input"], {
    dialogs: { "0": `${SA}\n` },
  });
  assert.equal(lingering.code, 75, lingering.stderr);
  assert.equal(lingering.stderr, SA_EVENT(SA));
  assert.equal(sleeps(sb).length, 10);
  const other = "SecurityAgent | Keychain | Deny, Allow";
  const fresh = await inputSandbox(t);
  const n = await fresh.wait(["30", "--after", ID, "--until-input"], {
    dialogs: { "0": `${SA}\n`, "3": `${SA}\n${other}\n` },
  });
  assert.equal(n.code, 75, n.stderr);
  assert.equal(n.stderr, SA_EVENT(other));
  assert.equal(sleeps(fresh.sb).length, 3);
});

test("--until-input never returns the idle 75", async (t) => {
  const { sb, wait } = await inputSandbox(t);
  const r = await wait(["5", "--after", ID, "--until-input"], {
    screen: "no recognizable prompt here",
  });
  assert.equal(r.code, 124);
  assert.equal(r.stderr, STILL(5));
  assert.equal(sleeps(sb).length, 5);
});

test("--until-input: the question ans --to answered is no event until the screen changes", async (t) => {
  const answered = await inputSandbox(t);
  const r = await answered.wait(["3", "--after", ID, "--until-input"], {
    screen: "Installing\n\nProceed? [Y/n] \n\n",
    answered: "Installing\nProceed? [Y/n] ",
  });
  assert.equal(r.code, 124, r.stderr);
  assert.equal(r.stderr, STILL(3));
  const { sb, wait } = await inputSandbox(t);
  const next = await wait(["30", "--after", ID, "--until-input"], {
    screen: "Installing\nProceed? [Y/n] ",
    answered: "Installing\nProceed? [Y/n] ",
    later: [2, "Proceed? [Y/n] \nProceed? [Y/n] "],
  });
  assert.equal(next.code, 75, next.stderr);
  assert.equal(next.stderr, PROMPT);
  assert.deepEqual(sleeps(sb), ["1", "1"]);
});

test("--until-input: a next question already up at the first read returns 75 at once", async (t) => {
  for (const answered of ["Proceed? [y/N] ", undefined]) {
    const { sb, wait } = await inputSandbox(t);
    const r = await wait(["30", "--after", ID, "--until-input"], {
      screen: "Proceed? [y/N] y\nOverwrite config? [y/N] ",
      ...(answered === undefined ? {} : { answered }),
    });
    assert.equal(r.code, 75, r.stderr);
    assert.equal(r.stderr, PROMPT);
    assert.deepEqual(sleeps(sb), []);
  }
});

test("--until-input: a 1 s recheck still reads the prompt after slow reads", async (t) => {
  const { sb, wait } = await inputSandbox(t);
  fs.writeFileSync(path.join(sb.dir, "slow"), "");
  const r = await wait(["1", "--after", ID, "--until-input"], { screen: "Password:" });
  assert.equal(r.code, 75, r.stderr);
  assert.equal(r.stderr, PASSWORD);
});
