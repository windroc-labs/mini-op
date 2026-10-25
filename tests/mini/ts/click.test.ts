import assert from "node:assert/strict";
import { test } from "node:test";
import { CG, Jxa } from "../../lib/jxa.ts";

test("click moves, presses and releases the mouse at the point", () => {
  const jxa = Jxa.source("click");
  const r = jxa.osascript(["120", "45.5"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "clicked\n");
  assert.deepEqual(jxa.events, [
    { type: "mouse", event: CG.mouseMoved, x: 120, y: 45.5 },
    { type: "mouse", event: CG.leftMouseDown, x: 120, y: 45.5 },
    { type: "mouse", event: CG.leftMouseUp, x: 120, y: 45.5 },
  ]);
  assert.deepEqual(jxa.delays, [0.08, 0.08, 0.08]);
});

test("click needs two numbers", () => {
  for (const argv of [[], ["1"], ["1", "x"], ["1", ""], ["1", "2", "3"]]) {
    const jxa = Jxa.source("click");
    const r = jxa.osascript(argv);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /click: usage: click <x> <y>/);
    assert.deepEqual(jxa.events, []);
  }
});

test("the committed mini/js/click.js runs like its source", () => {
  const jxa = Jxa.compiled("click");
  assert.equal(jxa.call(["1", "2"]), "clicked");
  assert.equal(jxa.events.length, 3);
});
