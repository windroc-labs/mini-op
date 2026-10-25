import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Page, type PageEvent } from "../../../lib/page.ts";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const LINEARLOGIN = path.join(REPO, "mini/runbooks/setup-test-env/linearlogin");
const EMAIL = "role@x.com";
const LOGIN = "https://linear.app/login | Log in to Linear";
const PICKER = "https://linear.app/login | Choose a workspace";
const INBOX = "https://linear.app/ensemble-test/inbox | Inbox";

// Where a go.js eval sends the tab.
const goTo = (code = "") =>
  Page.run(code).page.events.flatMap((e: PageEvent) => (e.type === "navigate" ? [e.url] : []));
const GO = "(function page(url)";

const CODE_PAGE = "https://linear.app/login | Enter the code";

// The stand-in ~/apm/bin/o (a fake, never mini/bin/o) keeps the Linear tab's page in
// $FAKE_DIR/page: open shows $FAKE_DIR/start, the logout and the clicks move it on unless
// $FAKE_DIR/frozen exists, and the page read prints it as OpenCLI's JSON. The code field shows
// while $FAKE_DIR/codefield exists: Enter code manually makes it unless $FAKE_DIR/nofield exists.
const O = `p=$FAKE_DIR/page; to() { [[ -e $FAKE_DIR/frozen ]] || print -r -- "$1" > $p; }
case $1:$2 in
  open:*) cp $FAKE_DIR/start $p;;
  eval:'(function page(url)'*) to 'https://linear.app/logout | Log out of all workspaces';;
  eval:*'("length","input[name=authToken]")') [[ -e $FAKE_DIR/codefield ]] && n=0 || n=-1
    print -r -- "{\\"data\\":$n}";;
  eval:*) print -r -- "{\\"data\\":\\"$(<$p)\\"}";;
  click:*)
    case "$*" in
      *"--name Log out "*) to '${LOGIN}';;
      *"--text Continue with email "*) to 'https://linear.app/login | Enter your email address';;
      *"--role button --name Continue with email "*) to 'https://linear.app/login | Check your email';;
      *"--text Enter code manually "*) to '${CODE_PAGE}'
        [[ -e $FAKE_DIR/nofield ]] || touch $FAKE_DIR/codefield;;
    esac;;
esac`;

// The tab leaves the code page for $FAKE_DIR/landing.
const LANDS = 'cp $FAKE_DIR/landing $FAKE_DIR/page; rm -f -- "${FAKE_DIR:?}/codefield"';

// The stand-in maillink: follow lands the tab on $FAKE_DIR/landing.
const FOLLOWED: FakeRule = {
  argv: ["follow"],
  shell: "cp $FAKE_DIR/landing $FAKE_DIR/page; print followed",
  ignoresStdin: true,
};

async function sandbox(
  t: Parameters<typeof Sandbox.create>[0],
  opts: {
    start?: string;
    landing?: string;
    mark?: FakeRule;
    follow?: FakeRule;
    code?: FakeRule;
  } = {},
) {
  const sb = await Sandbox.create(t);
  fs.writeFileSync(path.join(sb.dir, "start"), `${opts.start ?? LOGIN}\n`);
  fs.writeFileSync(path.join(sb.dir, "landing"), `${opts.landing ?? INBOX}\n`);
  const stand = (name: string, dir: string, rules: FakeRule[]) => {
    sb.fake(name, rules);
    fs.mkdirSync(path.join(sb.home, "apm", dir), { recursive: true });
    fs.symlinkSync(path.join(sb.dir, "bin", name), path.join(sb.home, "apm", dir, name));
  };
  stand("o", "bin", [{ shell: O, ignoresStdin: true }]);
  stand("front", "bin", [{ ignoresStdin: true }]);
  stand("maillink", "runbooks/setup-test-env", [
    opts.mark ?? { argv: ["mark"], stdout: "marked\n", ignoresStdin: true },
    opts.follow ?? FOLLOWED,
    opts.code ?? { argv: ["code"], shell: `${LANDS}; print entered`, ignoresStdin: true },
  ]);
  sb.fake("osascript", [
    { program: "chrome.js", args: ["close"], ignoresStdin: true },
    { program: "keys.js", args: ["--front", "Chrome", "--enter"], shell: LANDS },
  ]);
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const run = (args = [EMAIL]) => sb.run(["zsh", LINEARLOGIN, ...args]);
  const sleeps = () =>
    sb
      .calls("sleep")
      .map((c) => c.argv[0])
      .join(" ");
  const actions = () =>
    sb
      .calls("o")
      .filter((c) => c.argv[0] !== "eval" || c.argv[1]?.startsWith(GO))
      .map((c) =>
        c.argv[0] === "eval"
          ? `eval go ${goTo(c.argv[1]).join(" ")}`
          : c.argv.slice(0, -4).join(" "),
      );
  return { sb, run, sleeps, actions };
}

test("a logged-out tab gets the login link for the email and lands past the login", async (t) => {
  const { sb, run, sleeps, actions } = await sandbox(t);
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `followed\nlanded: ${INBOX}\n`);
  assert.equal(r.stderr, "");
  assert.deepEqual(actions(), [
    "open https://linear.app/login",
    "click --text Continue with email",
    `type --name email address ${EMAIL}`,
    "click --role button --name Continue with email",
  ]);
  assert.deepEqual(
    sb.calls("maillink").map((c) => c.argv),
    [
      ["mark", EMAIL],
      ["follow", EMAIL],
    ],
  );
  assert.deepEqual(sb.calls("osascript")[0]?.argv.slice(-2), ["close", "linear.app/logout"]);
  assert.equal(sleeps(), "3 1");
});

test("a logged-in tab is logged out first", async (t) => {
  const { run, actions } = await sandbox(t, { start: PICKER });
  const r = await run();
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(actions().slice(0, 3), [
    "open https://linear.app/login",
    "eval go https://linear.app/logout",
    "click --name Log out",
  ]);
});

test("a page that never shows exits 124 timed out and goes no further", async (t) => {
  const { sb, run, sleeps, actions } = await sandbox(t);
  fs.writeFileSync(path.join(sb.dir, "frozen"), "");
  const r = await run();
  assert.equal(r.code, 124);
  assert.equal(r.stdout, "");
  assert.equal(
    r.stderr,
    `linearlogin: timed out after 15 s: expected 'email address', got: ${LOGIN}\n`,
  );
  assert.equal(sleeps(), ["3", "1", ...Array(15).fill("1")].join(" "));
  assert.ok(!actions().some((a) => a.startsWith("type")));
  assert.deepEqual(
    sb.calls("maillink").map((c) => c.argv[0]),
    ["mark"],
  );
});

test("a tab still on the login page after the link exits 124 timed out", async (t) => {
  const stuck = "https://linear.app/login | Check your email";
  const { run, sleeps } = await sandbox(t, { landing: stuck });
  const r = await run();
  assert.equal(r.code, 124);
  assert.equal(r.stdout, "followed\n");
  assert.equal(r.stderr, `linearlogin: timed out after 20 s: still on the login page: ${stuck}\n`);
  assert.equal(sleeps(), ["3", "1", ...Array(20).fill("1")].join(" "));
});

// maillink follow failing with `exit` and stderr `line`.
async function follow(t: Parameters<typeof Sandbox.create>[0], exit: number, line: string) {
  const { run } = await sandbox(t, {
    follow: { argv: ["follow"], stderr: line, exit, ignoresStdin: true },
  });
  return run();
}

test("maillink's failure exits 1, its line passed on", async (t) => {
  const line = "maillink: cannot open the link in the Linear tab\n";
  const r = await follow(t, 1, line);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, line);
});

test("maillink's timeout exits 124, its line passed on", async (t) => {
  const line = `maillink: timed out after 140 s: no fresh link for ${EMAIL}\n`;
  const r = await follow(t, 124, line);
  assert.equal(r.code, 124);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, line);
});

test("a mark that fails exits 1 before the login mail is requested", async (t) => {
  const line =
    "maillink: https://outlook.live.com/mail/0/ did not render in 15 s; marked nothing\n";
  const { sb, run, actions } = await sandbox(t, {
    mark: { argv: ["mark"], stderr: line, exit: 1, ignoresStdin: true },
  });
  const r = await run(["--code", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, line);
  assert.deepEqual(actions(), ["open https://linear.app/login"]);
  assert.deepEqual(
    sb.calls("maillink").map((c) => c.argv[0]),
    ["mark"],
  );
});

test("--code enters the mailed code at Enter code manually and lands", async (t) => {
  const { sb, run, sleeps, actions } = await sandbox(t);
  const r = await run(["--code", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `entered\nlanded: ${INBOX}\n`);
  assert.equal(r.stderr, "");
  assert.deepEqual(actions().slice(-2), [
    "click --role button --name Continue with email",
    "click --text Enter code manually",
  ]);
  assert.deepEqual(
    sb.calls("maillink").map((c) => c.argv),
    [
      ["mark", EMAIL],
      ["code", EMAIL],
    ],
  );
  assert.deepEqual(
    sb.calls("osascript").map((c) => c.program),
    ["chrome.js"],
  );
  assert.equal(sleeps(), "3 1");
});

test("--code presses Return when the code page has not moved on", async (t) => {
  const { sb, run, sleeps } = await sandbox(t, {
    code: { argv: ["code"], stdout: "entered\n", ignoresStdin: true },
  });
  const r = await run(["--code", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `entered\nlanded: ${INBOX}\n`);
  const keys = sb.calls("osascript").filter((c) => c.program === "keys.js");
  assert.deepEqual(
    keys.map((c) => [c.argv.slice(-3), c.stdin]),
    [[["--front", "Chrome", "--enter"], ""]],
  );
  assert.equal(sleeps(), "3 1 1 1 1");
});

test("--code without a code field exits 124 timed out before asking for the code", async (t) => {
  const { sb, run, sleeps } = await sandbox(t);
  fs.writeFileSync(path.join(sb.dir, "nofield"), "");
  const r = await run(["--code", EMAIL]);
  assert.equal(r.code, 124);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `linearlogin: timed out after 15 s: no code field: ${CODE_PAGE}\n`);
  assert.equal(sleeps(), ["3", "1", ...Array(15).fill("1")].join(" "));
  assert.deepEqual(
    sb.calls("maillink").map((c) => c.argv[0]),
    ["mark"],
  );
});

test("--code passes maillink's failure and timeout on", async (t) => {
  for (const [exit, line] of [
    [1, "maillink: cannot type the code into the Linear tab\n"],
    [124, `maillink: timed out after 140 s: no fresh code for ${EMAIL}\n`],
  ] as const) {
    const { run } = await sandbox(t, {
      code: { argv: ["code"], stderr: line, exit, ignoresStdin: true },
    });
    const r = await run(["--code", EMAIL]);
    assert.equal(r.code, exit);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, line);
  }
});

test("anything but one email address, --code before it, is a usage error", async (t) => {
  const { sb, run } = await sandbox(t);
  const bad = [[], [EMAIL, "x"], ["--no-such-option"], ["role"], ["-h", EMAIL], ["-r@x"]];
  for (const args of [...bad, ["--code"], [EMAIL, "--code"], ["--code", EMAIL, "x"]]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "linearlogin: usage: linearlogin [--code] <email>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and opens nothing", async (t) => {
  const { sb, run } = await sandbox(t);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^linearlogin \[--code\] <email> /);
  assert.deepEqual(sb.calls(), []);
});
