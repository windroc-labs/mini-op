import assert from "node:assert/strict";
import { test } from "node:test";
import { Page, type Element, type Scene } from "../../../lib/page.ts";

const LINKS = 'a[href*="linear.app/auth/email/"]';
const link = (email: string, n: number) =>
  `https://linear.app/auth/email/${encodeURIComponent(email)}/code${n}`;
const row = (id: string, label: string, text = ""): Element => ({
  selectors: ["[role=option]"],
  attributes: { "data-convid": id, "aria-label": label },
  text,
});
const scene = (): Scene => ({
  elements: [
    row("c3", "Unread Linear Login for Linear 10:42"),
    row("c2", "GitHub Your sign-in code 10:40"),
    row("c1", "Linear Login for Linear 10:01"),
    { selectors: [LINKS], href: link("other@x.com", 1) },
    { selectors: [LINKS], href: link("role+1@x.com", 2) },
    { selectors: [LINKS], href: link("role+1@x.com", 3) },
  ],
});

test("rows gives the ids of the rows whose label holds the text, newest first", () => {
  assert.equal(Page.source("outlook", scene()).call("rows", "Linear"), "c3\nc1");
  assert.equal(Page.source("outlook", scene()).call("rows", "Proton"), "");
});

test("a row without data-convid is known by its id; a matching row with neither is -", () => {
  const byId: Element = {
    selectors: ["[role=option]"],
    id: "r9",
    attributes: { "aria-label": "Linear a" },
  };
  const bare: Element = { selectors: ["[role=option]"], text: "Linear\nLogin for Linear" };
  const other: Element = { selectors: ["[role=option]"], text: "GitHub" };
  assert.equal(Page.source("outlook", { elements: [byId, other] }).call("rows", "Linear"), "r9");
  assert.equal(Page.source("outlook", { elements: [byId, bare] }).call("rows", "Linear"), "-");
});

test("rows is - until the list or the empty state renders", () => {
  assert.equal(Page.source("outlook", { text: "Loading" }).call("rows", "Linear"), "-");
  assert.equal(Page.source("outlook", { text: null }).call("rows", "Linear"), "-");
  for (const text of ["Nothing in folder\nLooks empty over here", "All done for the day"]) {
    assert.equal(Page.source("outlook", { text }).call("rows", "Linear"), "", text);
  }
});

test("open clicks the row with that id only", () => {
  const page = Page.source("outlook", scene());
  assert.equal(page.call("open", "c1"), "ok");
  assert.deepEqual(page.events, [{ type: "click", element: 2 }]);
  const none = Page.source("outlook", scene());
  assert.equal(none.call("open", "c9"), "");
  assert.deepEqual(none.events, []);
});

test("link gives the first login link for the email, decoded to match", () => {
  assert.equal(
    Page.source("outlook", scene()).call("link", "role+1@x.com"),
    link("role+1@x.com", 2),
  );
  assert.equal(Page.source("outlook", scene()).call("link", "none@x.com"), "");
});

test("code gives the open message's code, not one a row preview quotes", () => {
  const old = "use the login code directly: OLDCODE123";
  const elements = [row("c2", "Linear", `Login for Linear ${old}`), row("c1", "Linear")];
  const open = "use the login code directly: AB12-CD34E";
  const text = `Login for Linear ${old}\nLinear\n${open}.`;
  assert.equal(Page.source("outlook", { elements, text }).call("code"), "AB12-CD34E");
  const own = [row("c3", "Linear", `Login for Linear ${open}`), ...elements];
  const twice = `Login for Linear ${open}\n${text}`;
  assert.equal(Page.source("outlook", { elements: own, text: twice }).call("code"), "AB12-CD34E");
});

test("code is empty without exactly one code of 10 characters in the open message", () => {
  const cases = [
    "nothing here",
    "use the login code directly: SHORT1",
    "use the login code directly: ELEVENCHARS",
    "use the login code directly: AAAAAAAAAA and use the login code directly: BBBBBBBBBB",
  ];
  for (const text of cases) assert.equal(Page.source("outlook", { text }).call("code"), "", text);
  assert.equal(Page.source("outlook", { text: null }).call("code"), "");
});

test("an unknown op throws: the eval exits 1", () => {
  const bad = Page.source("outlook", scene()).opencli("peek", "a@b.c");
  assert.equal(bad.code, 1);
  const ok = Page.source("outlook", scene()).opencli("open", "c3");
  assert.equal(ok.code, 0);
  assert.throws(
    () => Page.source("outlook", scene()).call("peek", "a@b.c"),
    /outlook: unknown op peek/,
  );
});

test("the committed mini/js/page/outlook.js runs like its source", () => {
  const page = Page.compiled("outlook", scene());
  assert.equal(page.call("link", "other@x.com"), link("other@x.com", 1));
  assert.equal(page.call("rows", "Linear"), "c3\nc1");
});
