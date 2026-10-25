import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Page, type PageEvent } from "../../../lib/page.ts";
import { REPO, Sandbox, type FakeRule } from "../../../lib/sandbox.ts";

const MAILLINK = path.join(REPO, "mini/runbooks/setup-test-env/maillink");
const EMAIL = "role+1@x.com";
const MARK = "home/apm/state/maillink.role_1_x_com";
const link = (n: number) => `https://linear.app/auth/email/${EMAIL}/code${n}`;

// Where a go.js eval sends the tab.
const goTo = (code = "") =>
  Page.run(code).page.events.flatMap((e: PageEvent) => (e.type === "navigate" ? [e.url] : []));
const GO = "(function page(url)";

// The stand-in ~/apm/bin/o (a fake, never mini/bin/o) answers the newest-link read with the
// lines of $FAKE_DIR/links in turn, the last one again once they run out.
const O = `case $1:$2 in
  eval:*'})("link",'*)
    n=$(( $(cat $FAKE_DIR/n 2>/dev/null || print 0) + 1 )); print $n > $FAKE_DIR/n
    links=("\${(@f)$(<$FAKE_DIR/links)}")
    print -r -- "{\\"data\\":\\"\${links[$n]:-\${links[-1]}}\\"}";;
  eval:*'})("open")') print -r -- '{"ok":true,"data":"ok"}';;
  eval:'(function page(url)'*) [[ ! -e $FAKE_DIR/open-fails ]] || exit 1;;
esac`;

async function sandbox(t: Parameters<typeof Sandbox.create>[0], links: string[]) {
  const sb = await Sandbox.create(t);
  fs.writeFileSync(path.join(sb.dir, "links"), links.join("\n") + "\n");
  for (const name of ["o", "front"]) {
    const rules: FakeRule[] = name === "o" ? [{ shell: O, ignoresStdin: true }] : [{}];
    sb.fake(name, rules);
    fs.mkdirSync(path.join(sb.home, "apm/bin"), { recursive: true });
    fs.symlinkSync(path.join(sb.dir, "bin", name), path.join(sb.home, "apm/bin", name));
  }
  sb.fake("sleep", [{ ignoresStdin: true }]);
  const run = (args: string[]) => sb.run(["zsh", MAILLINK, ...args]);
  const opened = () =>
    sb
      .calls("o")
      .filter((c) => c.argv[1]?.startsWith(GO))
      .map((c) => [c.argv[0], ...goTo(c.argv[1]), ...c.argv.slice(2)]);
  const sleeps = () =>
    sb
      .calls("sleep")
      .map((c) => c.argv[0])
      .join(" ");
  return { sb, run, opened, sleeps };
}

const noLink = (sb: Sandbox, r: { stdout: string; stderr: string }) => {
  for (const n of [1, 2, 3]) assert.ok(!(r.stdout + r.stderr).includes(`code${n}`));
  assert.ok(sb.calls().every((c) => c.cmd !== "front" || !c.argv.join(" ").includes("code")));
};

test("mark remembers the newest link without printing it", async (t) => {
  const { sb, run } = await sandbox(t, [link(1)]);
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "marked\n");
  assert.equal(r.stderr, "");
  assert.equal(fs.readFileSync(path.join(sb.dir, MARK), "utf8"), `${link(1)}\n`);
  assert.deepEqual(sb.calls("front")[0]?.argv, ["outlook.live.com"]);
  noLink(sb, r);
});

test("follow waits for a link other than the marked one and opens it in the Linear tab", async (t) => {
  const { sb, run, opened, sleeps } = await sandbox(t, [link(1), link(1), link(2)]);
  fs.mkdirSync(path.join(sb.home, "apm/state"), { recursive: true });
  fs.writeFileSync(path.join(sb.dir, MARK), `${link(1)}\n`);
  const r = await run(["follow", EMAIL]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "followed\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(opened(), [["eval", link(2), "--session", "role"]]);
  assert.deepEqual(sb.calls("front").at(-1)?.argv, ["linear.app/auth"]);
  assert.equal(sleeps(), "30 3 10 3 10 3");
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
  noLink(sb, r);
});

test("follow exits 124 timed out when no fresh link comes", async (t) => {
  const { sb, run, opened, sleeps } = await sandbox(t, [link(1)]);
  fs.mkdirSync(path.join(sb.home, "apm/state"), { recursive: true });
  fs.writeFileSync(path.join(sb.dir, MARK), `${link(1)}\n`);
  const r = await run(["follow", EMAIL]);
  assert.equal(r.code, 124);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `maillink: timed out after 140 s: no fresh link for ${EMAIL}\n`);
  assert.deepEqual(opened(), []);
  assert.equal(sleeps(), ["30", ...Array(11).fill("3 10"), "3"].join(" "));
  assert.ok(!fs.existsSync(path.join(sb.dir, MARK)));
  noLink(sb, r);
});

test("follow exits 1 when the Linear tab does not take the link", async (t) => {
  const { sb, run, opened } = await sandbox(t, [link(2)]);
  fs.writeFileSync(path.join(sb.dir, "open-fails"), "");
  const r = await run(["follow", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "maillink: cannot open the link in the Linear tab\n");
  assert.equal(opened().length, 1);
  noLink(sb, r);
});

// The link comes from mail and goes into JavaScript source: anything but a Linear login link,
// e.g. one holding a quote, is refused before the eval.
test("follow refuses a fresh link that is not a Linear login link", async (t) => {
  for (const bad of [
    `${link(2)}'+alert(1)+'`,
    `https://linear.app.example/auth/email/${EMAIL}/c`,
  ]) {
    const { sb, run, opened } = await sandbox(t, [bad]);
    const r = await run(["follow", EMAIL]);
    assert.equal(r.code, 1, bad);
    assert.equal(r.stdout, "", bad);
    assert.equal(r.stderr, "maillink: the fresh link is not a Linear login link\n");
    assert.deepEqual(opened(), [], bad);
    assert.ok(!sb.calls("front").some((c) => c.argv[0] === "linear.app/auth"), bad);
    noLink(sb, r);
  }
});

test("mark exits 1 when it cannot make its state dir", async (t) => {
  const { sb, run } = await sandbox(t, [link(1)]);
  fs.writeFileSync(path.join(sb.home, "apm/state"), "not a dir");
  const r = await run(["mark", EMAIL]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "maillink: cannot make ~/apm/state\n");
  assert.deepEqual(sb.calls("o"), []);
});

test("anything but mark or follow and one email address is a usage error", async (t) => {
  const { sb, run } = await sandbox(t, [link(1)]);
  const bad = [[], ["mark"], ["peek", EMAIL], ["--no-such-option"], ["mark", "-x"]];
  for (const args of [...bad, ["mark", EMAIL, "x"], ["follow", "x'+alert(1)+'"], ["-h", EMAIL]]) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.stderr, "maillink: usage: maillink mark|follow <email>\n");
    assert.equal(r.stdout, "");
  }
  assert.deepEqual(sb.calls(), []);
});

test("-h prints the usage to stdout and opens nothing", async (t) => {
  const { sb, run } = await sandbox(t, [link(1)]);
  const r = await run(["-h"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^maillink mark\|follow <email> /);
  assert.deepEqual(sb.calls(), []);
});
