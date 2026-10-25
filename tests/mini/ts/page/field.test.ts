import assert from "node:assert/strict";
import { test } from "node:test";
import { Page, type Scene } from "../../../lib/page.ts";

const scene = (over: Scene = {}): Scene => ({
  elements: [
    { selectors: ["#user"], value: "alice" },
    {
      selectors: ["#pw"],
      type: "password",
      rect: { left: 100, top: 40, width: 200, height: 20 },
      value: "12chars-long",
    },
  ],
  window: { screenX: 10, screenY: 20, outer: [1000, 800], inner: [990, 700] },
  ...over,
});

test("point scrolls the field into view and gives its screen centre", () => {
  const page = Page.source("field", scene());
  assert.equal(page.call("point", "#pw"), "215 170");
  assert.deepEqual(page.events, [{ type: "scroll", element: 1, block: "center" }]);
});

test("point with no matching field gives an empty string and scrolls nothing", () => {
  const page = Page.source("field", scene());
  assert.equal(page.call("point", "#nope"), "");
  assert.deepEqual(page.events, []);
});

test("focused needs the page focus and the active element to match", () => {
  assert.equal(Page.source("field", scene({ focus: 1 })).call("focused", "#pw"), true);
  assert.equal(Page.source("field", scene({ focus: 0 })).call("focused", "#pw"), false);
  assert.equal(Page.source("field", scene()).call("focused", "#pw"), false);
  const blurred = scene({ focus: 1, hasFocus: false });
  assert.equal(Page.source("field", blurred).call("focused", "#pw"), false);
});

test("length gives the value's length, -1 with no field", () => {
  assert.equal(Page.source("field", scene()).call("length", "#pw"), 12);
  assert.equal(Page.source("field", scene()).call("length", "#nope"), -1);
});

test("an unknown op throws: the eval exits 1", () => {
  assert.throws(() => Page.source("field", scene()).call("fill", "#pw"), /field: unknown op fill/);
  const bad = Page.source("field", scene()).opencli("fill", "#pw");
  assert.equal(bad.code, 1);
  const r = Page.source("field", scene()).opencli("length", "#pw");
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{"ok":true,"data":12}\n');
});

test("the committed mini/js/page/field.js runs like its source", () => {
  assert.equal(Page.compiled("field", scene()).call("point", "#pw"), "215 170");
});

test("point masks a code field before focusing it; focused refuses unmasked input", () => {
  const s: Scene = { elements: [{ selectors: ["#code"], type: "text" }], focus: 0 };
  const page = Page.source("field", s);
  assert.equal(page.call("focused", "#code"), false);
  assert.equal(page.call("point", "#code"), "0 100");
  assert.equal(s.elements?.[0]?.type, "password");
  assert.equal(page.call("focused", "#code"), true);
});

test("point refuses a field that cannot mask its value", () => {
  const page = Page.source("field", {
    elements: [{ selectors: ["#code"], type: "text", rejectMask: true }],
  });
  assert.equal(page.call("point", "#code"), "");
  assert.deepEqual(page.events, []);
});
