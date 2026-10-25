import assert from "node:assert/strict";
import { test } from "node:test";
import { Page } from "../../../lib/page.ts";

const URL = "https://linear.app/auth/email/a@b.c/token";

test("go opens the URL in the tab and replies ok, never the URL", () => {
  const page = Page.source("go");
  assert.equal(page.call(URL), "ok");
  assert.deepEqual(page.events, [{ type: "navigate", url: URL }]);
});

test("as an eval, go replies ok, and fails on an invalid URL without navigating", () => {
  const ok = Page.source("go").opencli(URL);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout, '{"ok":true,"data":"ok"}\n');
  const page = Page.source("go");
  const bad = page.opencli("not a url");
  assert.equal(bad.code, 1);
  assert.deepEqual(page.events, []);
});

test("the committed mini/js/page/go.js runs like its source", () => {
  const page = Page.compiled("go");
  assert.equal(page.call(URL), "ok");
  assert.deepEqual(page.events, [{ type: "navigate", url: URL }]);
});
