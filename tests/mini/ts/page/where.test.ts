import assert from "node:assert/strict";
import { test } from "node:test";
import { Page } from "../../../lib/page.ts";

const scene = { href: "https://linear.app/login", text: `Log in\nto Linear${"x".repeat(80)}` };

test("where gives the URL and the text's first 60 characters on one line", () => {
  const value = Page.source("where", scene).call();
  assert.equal(value, `https://linear.app/login | Log in to Linear${"x".repeat(44)}`);
});

test("as an eval, where replies with data, and fails before the page has a body", () => {
  const r = Page.source("where", scene).opencli();
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).data, Page.source("where", scene).call());
  const loading = Page.source("where", { href: "https://linear.app/", text: null }).opencli();
  assert.equal(loading.code, 1);
  assert.equal(JSON.parse(loading.stdout).ok, false);
});

test("the committed mini/js/page/where.js runs like its source", () => {
  assert.equal(Page.compiled("where", scene).call(), Page.source("where", scene).call());
});
