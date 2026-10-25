import assert from "node:assert/strict";
import { test } from "node:test";
import { Page, type Scene } from "../../../lib/page.ts";

const LINKS = 'a[href*="linear.app/auth/email/"]';
const link = (email: string, n: number) =>
  `https://linear.app/auth/email/${encodeURIComponent(email)}/code${n}`;
const scene = (): Scene => ({
  elements: [
    { selectors: ["[role=option]"] },
    { selectors: ["[role=option]"] },
    { selectors: [LINKS], href: link("other@x.com", 1) },
    { selectors: [LINKS], href: link("role+1@x.com", 2) },
    { selectors: [LINKS], href: link("role+1@x.com", 3) },
  ],
});

test("open clicks the newest message only", () => {
  const page = Page.source("outlook", scene());
  assert.equal(page.call("open", ""), "ok");
  assert.deepEqual(page.events, [{ type: "click", element: 0 }]);
  assert.equal(Page.source("outlook", {}).call("open", ""), "");
});

test("link gives the first login link for the email, decoded to match", () => {
  assert.equal(
    Page.source("outlook", scene()).call("link", "role+1@x.com"),
    link("role+1@x.com", 2),
  );
  assert.equal(Page.source("outlook", scene()).call("link", "none@x.com"), "");
});

test("an unknown op throws: the eval exits 1", () => {
  const bad = Page.source("outlook", scene()).opencli("peek", "a@b.c");
  assert.equal(bad.code, 1);
  const ok = Page.source("outlook", scene()).opencli("open", "");
  assert.equal(ok.code, 0);
  assert.throws(
    () => Page.source("outlook", scene()).call("peek", "a@b.c"),
    /outlook: unknown op peek/,
  );
});

test("the committed mini/js/page/outlook.js runs like its source", () => {
  const page = Page.compiled("outlook", scene());
  assert.equal(page.call("link", "other@x.com"), link("other@x.com", 1));
});
