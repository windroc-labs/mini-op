import assert from "node:assert/strict";
import { test } from "node:test";
import { Jxa, type Scene } from "../../lib/jxa.ts";

const scene = (): Scene => ({
  processes: [
    { name: "Finder", visible: true, windows: [{ name: "Desktop" }] },
    {
      name: "UserNotificationCenter",
      backgroundOnly: true,
      visible: false,
      windows: [{ name: null, buttons: ["Don’t Allow", "Allow"] }],
    },
    { name: "Hidden", visible: false, windows: [{ name: "x", buttons: ["OK"] }] },
    { name: "Locked", visible: true, unreadable: true },
    {
      name: "Rosetta",
      visible: true,
      windows: [{ name: "Install", buttons: ["Install", "Not Now"] }],
    },
  ],
});

test("dialogs lists every visible or background window with buttons", () => {
  const r = Jxa.source("dialogs", scene()).osascript();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    "UserNotificationCenter |  | Don’t Allow, Allow\nRosetta | Install | Install, Not Now\n",
  );
});

test("dialogs click presses the button in the first window that has it", () => {
  const jxa = Jxa.source("dialogs", scene());
  assert.equal(jxa.call(["click", "Not Now"]), "clicked Not Now in Rosetta");
  assert.deepEqual(jxa.events, [{ type: "click", process: "Rosetta", button: "Not Now" }]);
});

test("dialogs click with no such button fails", () => {
  const jxa = Jxa.source("dialogs", scene());
  const r = jxa.osascript(["click", "OK"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /dialogs: no window has a button OK/);
  assert.deepEqual(jxa.events, []);
});

test("other arguments are usage errors", () => {
  for (const argv of [["click"], ["list"], ["click", "a", "b"]]) {
    assert.throws(
      () => Jxa.source("dialogs", scene()).call(argv),
      /dialogs: usage: dialogs \[click <button>\]/,
    );
  }
});

test("the committed mini/js/dialogs.js runs like its source", () => {
  assert.match(String(Jxa.compiled("dialogs", scene()).call()), /^UserNotificationCenter/);
});
