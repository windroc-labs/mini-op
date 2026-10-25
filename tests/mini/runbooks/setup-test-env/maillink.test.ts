import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Page, type PageEvent } from "../../../lib/page.ts";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const MAILLINK = path.join(REPO, "mini/runbooks/setup-test-env/maillink");
const EMAIL = "role+1@x.com";
const MARK = "home/apm/state/maillink.role_1_x_com";
const INBOX = "https://outlook.live.com/mail/0/";
const JUNK = "https://outlook.live.com/mail/0/junkemail";
const CODE = "AB12-CD34E";
const link = (n: number) => `https://linear.app/auth/email/${EMAIL}/code${n}`;

// The private auth program consumes the link through stdin, never a navigation argv.
const goTo = (code = "") =>
  Page.run(code, { href: "https://linear.app/login" }).page.events.flatMap((e: PageEvent) =>
    e.type === "fetch" ? [e.url] : [],
  );

// A folder's list as each read finds it, the last one again once they run out: "-" not rendered
// yet, else the ids of its Linear mails, newest first.
type Reads = ("-" | string[])[];
type Mail = { link?: string; code?: string };

// The stand-in ~/apm/bin/o (a fake, never mini/bin/o): open shows the folder its URL names, a
// rows read answers that folder's next read from $FAKE_DIR/<folder>, open remembers the mail, and
// link and code reads answer from $FAKE_DIR/mail/<id>.<op>.
const O = `f=$(cat $FAKE_DIR/folder 2>/dev/null || echo inbox)
case $1:$2 in
  open:*junkemail) echo junk > $FAKE_DIR/folder;;
  open:*) echo inbox > $FAKE_DIR/folder;;
  eval:*'("rows",'*)
    n=$(( $(cat $FAKE_DIR/$f.n 2>/dev/null || echo 0) + 1 )); echo $n > $FAKE_DIR/$f.n
    r=$(sed -n "$n p" $FAKE_DIR/$f); [ -n "$r" ] || r=$(tail -n 1 $FAKE_DIR/$f); echo "$r";;
  eval:*'("open",'*)
    echo "$2" | sed -n 's/.*("open","\\([^"]*\\)").*/\\1/p' > $FAKE_DIR/current; echo '{"data":"ok"}';;
  eval:*'("link",'*) cat $FAKE_DIR/mail/$(cat $FAKE_DIR/current).link 2>/dev/null || echo '{"data":""}';;
  eval:*'("code",'*) cat $FAKE_DIR/mail/$(cat $FAKE_DIR/current).code 2>/dev/null || echo '{"data":""}';;
esac`;

const TYPED: FakeRule = { stdout: "secfield: input[name=authToken] filled, 10 chars\n" };

async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  folders: { inbox: Reads; junk: Reads },
  mails: Record<string, Mail> = {},
  secfield: FakeRule = TYPED,
) {
  const sb = await Sandbox.create(t);
  const reply = (data: string) => `${JSON.stringify({ data })}\n`;
  for (const [name, reads] of Object.entries(folders)) {
    const lines = reads.map((r) => reply(r === "-" ? r : r.join("\n")));
    fs.writeFileSync(path.join(sb.dir, name), lines.join(""));
  }
  fs.mkdirSync(path.join(sb.dir, "mail"));
  for (const [id, mail] of Object.entries(mails)) {
    for (const [op, data] of Object.entries(mail)) {
      fs.writeFileSync(path.join(sb.dir, "mail", `${id}.${op}`), reply(data));
    }
  }
  const stands: [string, FakeRule[]][] = [
    ["o", [{ shell: O, ignoresStdin: true }]],
    ["front", [{ ignoresStdin: true }]],
    ["secfield", [secfield]],
  ];
  for (const [name, rules] of stands) {
    sb.fake(name, rules);
    fs.mkdirSync(path.join(sb.home, "apm/bin"), { recursive: true });
    fs.symlinkSync(path.join(sb.dir, "bin", name), path.join(sb.home, "apm/bin", name));
  }
  sb.fake("osascript", [
    { program: "chrome.js", args: ["auth"], shell: "[[ ! -e $FAKE_DIR/open-fails ]]" },
  ]);
  // A clock that only the fake sleep moves on: date +%s reads it.
  const clock = "c=$FAKE_DIR/clock; print $(( $(cat $c 2>/dev/null || print 0) + $1 )) > $c";
  sb.fake("sleep", [{ shell: clock, ignoresStdin: true }]);
  sb.fake("date", [{ shell: "cat $FAKE_DIR/clock 2>/dev/null || print 0", ignoresStdin: true }]);
  // Polling two folders makes many fake calls: give them time.
  const run = (args: string[]) => sb.run(["zsh", MAILLINK, ...args], { timeoutMs: 60000 });
  const opened = () =>
    sb
      .calls("osascript")
      .filter((c) => c.program === "chrome.js" && c.argv.at(-1) === "auth")
      .map((c) => ["auth", ...goTo(c.stdin)]);
  const mailsOpened = () =>
    sb.calls("o").flatMap((c) => /\("open","([^"]*)"\)$/.exec(c.argv[1] ?? "")?.[1] ?? []);
  const sleeps = () =>
    sb
      .calls("sleep")
      .map((c) => c.argv[0])
      .join(" ");
  const mark = (ids: string[]) => {
    fs.mkdirSync(path.join(sb.home, "apm/state"), { recursive: true });
    fs.writeFileSync(path.join(sb.dir, MARK), ids.map((id) => `${id}\n`).join(""));
  };
  return { sb, run, opened, mailsOpened, sleeps, mark };
}

// Neither a link nor the code shows in output or in any process arguments.
const noSecret = (sb: Sandbox, r: { stdout: string; stderr: string }) => {
  const calls = sb.calls();
  for (const s of [CODE, "code1", "code2"]) {
    assert.ok(!(r.stdout + r.stderr).includes(s), s);
    assert.ok(
      calls.every((c) => !c.argv.join(" ").includes(s)),
      s,
    );
  }
};

test("mark remembers the Linear mails of both folders once listed, opening none", async (t) => {
  const { sb, run, mailsOpened, sleeps } = await sandbox(t, {
    inbox: ["-", ["c2", "c1"]],
    junk: [["j1"]],
  });
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "marked\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls("front"), []);
  assert.ok(sb.calls("o").every((c) => c.argv.includes("--private")));
  assert.equal(fs.statSync(path.join(sb.dir, MARK)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(sb.dir, MARK), "utf8"), "c2\nc1\nj1\n");
  assert.deepEqual(
    sb.calls("o").flatMap((c) => (c.argv[0] === "open" ? [c.argv[1]] : [])),
    [INBOX, JUNK],
  );
  assert.deepEqual(mailsOpened(), []);
  assert.equal(sleeps(), "1");
});

test("mark exits 1 and marks nothing when a folder never lists", async (t) => {
  const { sb, run, sleeps, mark } = await sandbox(t, { inbox: [["c1"]], junk: ["-"] });
  mark(["stale"]);
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `maillink: ${JUNK} did not render in 15 s; marked nothing\n`);
  assert.equal(sleeps(), Array(15).fill("1").join(" "));
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
});

test("mark deletes the previous baseline before the first folder read", async (t) => {
  const { sb, run, mark } = await sandbox(t, { inbox: [["new"]], junk: [[]] });
  mark(["stale"]);
  sb.fake("o", [
    {
      shell: `[[ ! -e $HOME/apm/state/maillink.role_1_x_com ]] || exit 1\n${O}`,
      ignoresStdin: true,
    },
  ]);
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(sb.dir, MARK), "utf8"), "new\n");
});

test("follow opens the link of a Linear mail not marked, in Junk Email too", async (t) => {
  const { sb, run, opened, mailsOpened, sleeps, mark } = await sandbox(
    t,
    { inbox: [["c1"], ["c3", "c1"]], junk: [["j1"], ["j2", "j1"]] },
    { c1: { link: link(1) }, c3: { code: CODE }, j1: { link: link(1) }, j2: { link: link(2) } },
  );
  mark(["c1", "j1"]);
  const r = await run(["follow", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "followed\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(opened(), [["auth", link(2)]]);
  assert.ok(sb.calls().every((c) => !c.argv.some((arg) => arg.includes("code2"))));
  assert.deepEqual(mailsOpened(), ["c3", "j2"]);
  assert.deepEqual(sb.calls("front").at(-1)?.argv, ["linear.app"]);
  assert.equal(sleeps(), "5 5 3 3");
  assert.deepEqual(sb.calls("secfield"), []);
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
  noSecret(sb, r);
});

test("code types the fresh mail's code into the Linear tab's code field only", async (t) => {
  const { sb, run, opened, mailsOpened, sleeps, mark } = await sandbox(
    t,
    { inbox: ["-", ["c1"]], junk: [["j2", "j1"]] },
    { j2: { code: CODE } },
  );
  mark(["c1", "j1"]);
  const r = await run(["code", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "entered\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(mailsOpened(), ["j2"]);
  assert.deepEqual(opened(), []);
  assert.equal(sleeps(), "5 1 3");
  assert.deepEqual(
    sb.calls("secfield").map((c) => [c.argv, c.stdin]),
    [[["role", "input[name=authToken]"], CODE]],
  );
  assert.deepEqual(sb.calls("front").at(-1)?.argv, ["linear.app"]);
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
  noSecret(sb, r);
});

test("follow and code exit 124 timed out when no fresh mail comes", async (t) => {
  for (const [cmd, what] of [
    ["follow", "link"],
    ["code", "code"],
  ] as const) {
    const { sb, run, opened, mailsOpened, sleeps, mark } = await sandbox(
      t,
      { inbox: [["c1"]], junk: [[]] },
      { c1: { link: link(1), code: CODE } },
    );
    mark(["c1"]);
    const r = await run([cmd, EMAIL]);
    assert.equal(r.code, 124, cmd);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `maillink: timed out after 140 s: no fresh ${what} for ${EMAIL}\n`);
    assert.deepEqual(mailsOpened(), []);
    assert.deepEqual(opened(), []);
    assert.deepEqual(sb.calls("secfield"), []);
    assert.equal(sleeps(), "5 5 10 20 40 40 20");
    assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
  }
});

test("follow and code exit 1 with no mark, opening no mail", async (t) => {
  for (const cmd of ["follow", "code"]) {
    const { sb, run, mailsOpened } = await sandbox(
      t,
      { inbox: [["c2", "c1"]], junk: [[]] },
      { c1: { link: link(1), code: CODE } },
    );
    const r = await run([cmd, EMAIL]);
    assert.equal(r.code, 1, cmd);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `maillink: no mark for ${EMAIL}: run maillink mark first\n`);
    assert.deepEqual(sb.calls("o"), []);
    assert.deepEqual(mailsOpened(), []);
    assert.deepEqual(sb.calls("secfield"), []);
  }
});

// The Inbox takes 15 s to render at the first look and never renders at the sixth, at 135 s: the
// gaps and that last render wait are cut so the looks end at 140 s.
test("render waits count toward the 140 s, and a folder not rendered is named", async (t) => {
  const ones = (n: number) => Array(n).fill("1");
  const inbox: Reads = [...Array(16).fill("-"), [], [], [], [], "-"];
  const { sb, run, sleeps, mark } = await sandbox(t, { inbox, junk: [[]] });
  mark([]);
  const r = await run(["code", EMAIL]);
  assert.equal(r.code, 124);
  assert.equal(
    r.stderr,
    `maillink: timed out after 140 s: no fresh code for ${EMAIL}; did not render on some look: ${INBOX}\n`,
  );
  assert.equal(sleeps(), ["5", ...ones(15), "5", "10", "20", "40", "40", ...ones(5)].join(" "));
  assert.deepEqual(sb.calls("secfield"), []);
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
});

test("follow exits 1 when the Linear tab does not take the link", async (t) => {
  const { sb, run, opened, mark } = await sandbox(
    t,
    { inbox: [["c2"]], junk: [[]] },
    { c2: { link: link(2) } },
  );
  fs.writeFileSync(path.join(sb.dir, "open-fails"), "");
  mark([]);
  const r = await run(["follow", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "maillink: cannot open the link in the Linear tab\n");
  assert.equal(opened().length, 1);
  noSecret(sb, r);
});

test("code exits 1 when the code cannot be typed", async (t) => {
  const refused =
    "secfield: focus not on input[name=authToken] (page focus: false); typed nothing\n";
  const { sb, run, mark } = await sandbox(
    t,
    { inbox: [["c2"]], junk: [[]] },
    { c2: { code: CODE } },
    { stderr: refused, exit: 1 },
  );
  mark([]);
  const r = await run(["code", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `${refused}maillink: cannot type the code into the Linear tab\n`);
  assert.equal(sb.calls("secfield")[0]?.stdin, CODE);
  noSecret(sb, r);
});

// The link comes from mail and goes into JavaScript source: anything but a Linear login link,
// e.g. one holding a quote, is refused before the eval.
test("follow refuses a fresh link that is not a Linear login link", async (t) => {
  for (const bad of [
    `${link(2)}'+alert(1)+'`,
    `https://linear.app.example/auth/email/${EMAIL}/c`,
  ]) {
    const { sb, run, opened, mark } = await sandbox(
      t,
      { inbox: [["c2"]], junk: [[]] },
      { c2: { link: bad } },
    );
    mark([]);
    const r = await run(["follow", EMAIL]);
    assert.equal(r.code, 1, bad);
    assert.equal(r.stdout, "", bad);
    assert.equal(r.stderr, "maillink: the fresh link is not a Linear login link\n");
    assert.deepEqual(opened(), [], bad);
    assert.ok(!sb.calls("front").some((c) => c.argv[0] === "linear.app/auth"), bad);
    noSecret(sb, r);
  }
});

test("mark exits 1 when it cannot make its state dir", async (t) => {
  const { sb, run } = await sandbox(t, { inbox: [[]], junk: [[]] });
  fs.writeFileSync(path.join(sb.home, "apm/state"), "not a dir");
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "maillink: cannot make ~/apm/state\n");
  assert.deepEqual(sb.calls("o"), []);
});

test("anything but mark, follow or code and one email address is a usage error", async (t) => {
  const { sb, run } = await sandbox(t, { inbox: [[]], junk: [[]] });
  const bad = [[], ["mark"], ["peek", EMAIL], ["--no-such-option"], ["code", "-x"]];
  for (const args of [...bad, ["mark", EMAIL, "x"], ["follow", "x'+alert(1)+'"], ["-h", EMAIL]]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "maillink: usage: maillink mark|follow|code <email>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and opens nothing", async (t) => {
  const { sb, run } = await sandbox(t, { inbox: [[]], junk: [[]] });
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^maillink mark\|follow\|code <email> /);
  assert.deepEqual(sb.calls(), []);
});
