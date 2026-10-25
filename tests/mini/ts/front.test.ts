import assert from "node:assert/strict";
import { test } from "node:test";
import { Jxa, type Scene } from "../../lib/jxa.ts";

const scene = (): Scene => ({
  chrome: [
    { tabs: [{ url: "https://outlook.live.com/mail/0/" }] },
    { tabs: [{ url: "https://example.com" }, { url: "https://linear.app/login" }] },
  ],
});

test("front raises the first tab whose URL contains the text", () => {
  const jxa = Jxa.source("front", scene());
  const r = jxa.osascript(["linear.app"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "front\n");
  assert.deepEqual(jxa.events, [
    { type: "tab", window: 1, index: 2 },
    { type: "raise", window: 1 },
    { type: "activate", app: "Google Chrome" },
  ]);
});

test("front with no matching tab fails and raises nothing", () => {
  const jxa = Jxa.source("front", scene());
  const r = jxa.osascript(["github.com"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /front: no Chrome tab's URL contains github\.com/);
  assert.deepEqual(jxa.events, []);
});

test("front needs one non-empty argument", () => {
  for (const argv of [[], [""], ["a", "b"]]) {
    assert.throws(
      () => Jxa.source("front", scene()).call(argv),
      /front: usage: front <url-substring>/,
    );
  }
});

test("the committed mini/js/front.js runs like its source", () => {
  assert.equal(Jxa.compiled("front", scene()).call(["outlook"]), "front");
});
