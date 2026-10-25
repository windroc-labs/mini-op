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
