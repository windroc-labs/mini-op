import assert from "node:assert/strict";
import { test } from "node:test";
import { Jxa, type Scene } from "../../lib/jxa.ts";

const scene = (): Scene => ({
  chrome: [
    {
      tabs: [
        { url: "https://linear.app/logout" },
        { url: "https://a" },
        { url: "https://linear.app/logout?x" },
      ],
    },
    { tabs: [{ url: "https://linear.app/logout" }] },
  ],
});

test("activate brings Chrome to the front", () => {
  const jxa = Jxa.source("chrome", scene());
  const r = jxa.osascript(["activate"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "activated\n");
  assert.deepEqual(jxa.events, [{ type: "activate", app: "Google Chrome" }]);
});

test("close closes every tab whose URL contains the text, and only those", () => {
  const s = scene();
  const jxa = Jxa.source("chrome", s);
  assert.equal(jxa.call(["close", "linear.app/logout"]), "closed 3");
  assert.deepEqual(
    s.chrome?.map((w) => w.tabs.map((t) => t.url)),
    [["https://a"], []],
  );
  assert.equal(Jxa.source("chrome", s).call(["close", "nothing"]), "closed 0");
});

test("other arguments are usage errors", () => {
  for (const argv of [[], ["close"], ["close", ""], ["activate", "x"], ["open", "x"]]) {
    const r = Jxa.source("chrome", scene()).osascript(argv);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /chrome: usage: chrome activate\|close <url-substring>/);
  }
});

test("the committed mini/js/chrome.js runs like its source", () => {
  assert.equal(Jxa.compiled("chrome", scene()).call(["close", "https://a"]), "closed 1");
});

test("hide verifies Chrome is hidden and does not activate it", () => {
  const s: Scene = { processes: [{ name: "Google Chrome", visible: true }] };
  const jxa = Jxa.source("chrome", s);
  const r = jxa.osascript(["hide"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.processes?.[0]?.visible, false);
  assert.deepEqual(jxa.events, [{ type: "hide", process: "Google Chrome" }]);
});

test("hide fails closed when the accessibility setter leaves Chrome visible", () => {
  const s: Scene = {
    processes: [{ name: "Google Chrome", visible: true, visibilityChanges: false }],
  };
  const jxa = Jxa.source("chrome", s);
  const r = jxa.osascript(["hide"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot hide Chrome/);
  assert.equal(s.processes?.[0]?.visible, true);
  assert.deepEqual(jxa.events, [{ type: "hide", process: "Google Chrome" }]);
});

test("auth consumes only stdin and navigates only a safe final path", () => {
  const s: Scene = {
    stdin: "trusted page program with secret",
    chrome: [
      {
        tabs: [
          { url: "https://linear.app/login", javascript: ["pending", "pending", "/workspace"] },
        ],
      },
    ],
  };
  const jxa = Jxa.source("chrome", s);
  const r = jxa.osascript(["auth"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "authenticated\n");
  assert.equal(s.chrome?.[0]?.tabs[0]?.url, "https://linear.app/workspace");
  assert.deepEqual(
    jxa.events.filter((event) => event.type === "execute").map((event) => event.javascript),
    [s.stdin, "globalThis.__miniAuth || 'pending'", "globalThis.__miniAuth || 'pending'"],
  );
  assert.ok(!(r.stdout + r.stderr).includes("secret"));
});

test("auth fails without leaking browser errors, ambiguous tabs, unsafe paths or timeouts", () => {
  for (const tabs of [
    [],
    [{ url: "https://linear.app.evil/login" }],
    [{ url: "https://linear.app/login" }, { url: "https://linear.app/other" }],
    [{ url: "https://linear.app/login", javascript: ["pending", "failed"] }],
    [{ url: "https://linear.app/login", javascript: ["pending", "/auth/email/secret"] }],
    [{ url: "https://linear.app/login", javascript: ["pending"] }],
    [{ url: "https://linear.app/login", javascriptError: "secret browser error" }],
  ]) {
    const s: Scene = { stdin: "secret", chrome: [{ tabs }] };
    const r = Jxa.source("chrome", s).osascript(["auth"]);
    assert.equal(r.code, 1);
    assert.ok(!(r.stdout + r.stderr).includes("secret"));
    assert.ok(!s.chrome?.[0]?.tabs.some((tab) => tab.url?.includes("workspace")));
  }
});
