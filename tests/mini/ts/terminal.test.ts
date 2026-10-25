import assert from "node:assert/strict";
import { test } from "node:test";
import { Jxa, type Scene } from "../../lib/jxa.ts";

const scene = (extra: Scene = {}): Scene => ({
  processes: [{ name: "Google Chrome" }],
  terminal: [
    {
      tabs: [
        { history: "h0", contents: "c0" },
        { history: "h1", contents: "c1" },
      ],
      selected: 1,
    },
    { tabs: [{ history: "h2", contents: "c2" }] },
  ],
  ...extra,
});

test("activate hides Chrome, activates Terminal and returns once it is frontmost", () => {
  const jxa = Jxa.source("terminal", scene({ front: "Google Chrome" }));
  const r = jxa.osascript(["activate"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "Terminal\n");
  assert.deepEqual(jxa.events, [
    { type: "hide", process: "Google Chrome" },
    { type: "activate", app: "Terminal" },
  ]);
  assert.deepEqual(jxa.delays, [0.5]);
});

test("activate without Chrome running only activates Terminal", () => {
  const jxa = Jxa.source("terminal", scene({ processes: [] }));
  jxa.call(["activate"]);
  assert.deepEqual(jxa.events, [{ type: "activate", app: "Terminal" }]);
});

test("activate fails when Terminal does not come to the front", () => {
  const r = Jxa.source("terminal", scene({ front: "Finder", activates: false })).osascript([
    "activate",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /terminal: Terminal not frontmost \(Finder\)/);
});

test("front names the frontmost process", () => {
  assert.equal(Jxa.source("terminal", scene({ front: "Finder" })).call(["front"]), "Finder");
});

test("history and contents read the front window's selected tab; --all reads every tab", () => {
  const jxa = Jxa.source("terminal", scene());
  assert.equal(jxa.call(["history"]), "h1");
  assert.equal(jxa.call(["contents"]), "c1");
  assert.equal(jxa.call(["history", "--all"]), "h0\nh1\nh2");
});

test("bottom presses Cmd+End", () => {
  const jxa = Jxa.source("terminal", scene());
  assert.equal(jxa.call(["bottom"]), "bottom");
  assert.deepEqual(jxa.events, [{ type: "keyCode", code: 119, using: "command down" }]);
});

test("other arguments are usage errors", () => {
  for (const argv of [
    [],
    ["scroll"],
    ["history", "--some"],
    ["front", "x"],
    ["contents", "--all"],
  ]) {
    assert.throws(
      () => Jxa.source("terminal", scene()).call(argv),
      /terminal: usage: terminal activate\|front\|history \[--all\]\|contents\|bottom/,
      argv.join(" "),
    );
  }
});

test("the committed mini/js/terminal.js runs like its source", () => {
  assert.equal(Jxa.compiled("terminal", scene()).call(["history", "--all"]), "h0\nh1\nh2");
});
