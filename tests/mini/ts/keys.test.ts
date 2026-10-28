import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Jxa, type Field, type Process, type Scene, type Window } from "../../lib/jxa.ts";
import { REPO } from "../../lib/repo.ts";

const SECRET = "canary-keys-7f3a";
const keys = (scene: Scene) => Jxa.source("keys", scene);

const dialog = (field: Field): Window => ({
  buttons: ["Always Allow", "Deny", "Allow"],
  fields: [{ subrole: "AXSecureTextField", ...field }],
});

function agent(field: Field, front = "SecurityAgent"): Scene {
  return { front, processes: [{ name: "SecurityAgent", windows: [dialog(field)] }] };
}

// A SecurityAgent that asks `asks` times in a row: each click closes its dialog and, on the next
// delay, the next one opens with `next` as its field.
function asking(asks: number, next: Field = { focused: true }): Scene {
  const scene = agent({ focused: true });
  const sa = scene.processes?.[0] as Process;
  let left = asks - 1;
  let opening = false;
  scene.onClick = () => {
    sa.windows = [];
    opening = left > 0;
  };
  scene.onDelay = () => {
    if (!opening) return;
    opening = false;
    left--;
    sa.windows = [dialog({ ...next })];
  };
  return scene;
}

const SA = ["--front", "SecurityAgent", "--secret", "--verify-field"];
const ALLOW = { type: "click", process: "SecurityAgent", button: "Allow" };

const clicks = (jxa: Jxa) => jxa.events.filter((e) => e.type === "click");
const presses = (jxa: Jxa) =>
  jxa.events.filter((e) => e.type === "keystroke" || e.type === "keyCode");

test("\\r\\n and \\n endings type the same characters", () => {
  const crlf = keys({ stdin: "abc\r\n" });
  const lf = keys({ stdin: "abc\n" });
  const r = crlf.osascript();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lf.osascript().code, 0);
  assert.equal(crlf.typed(), "abc");
  assert.equal(lf.typed(), "abc");
  assert.equal(r.stdout, "keys: typed 3 characters\n");
});

test("only one trailing newline is stripped", () => {
  const jxa = keys({ stdin: "a\nb\n\n" });
  jxa.call();
  assert.equal(jxa.typed(), "a\nb\n");
});

test("--enter presses Return after typing", () => {
  const jxa = keys({ stdin: "ls\n" });
  assert.equal(jxa.call(["--enter"]), "keys: typed 2 characters, Enter");
  assert.deepEqual(presses(jxa), [
    { type: "keystroke", text: "ls" },
    { type: "keyCode", code: 36 },
  ]);
});

test("empty input with --enter presses only Return", () => {
  const jxa = keys({ stdin: "" });
  jxa.call(["--enter"]);
  assert.deepEqual(presses(jxa), [{ type: "keyCode", code: 36 }]);
});

test("--front Terminal activates Terminal first and types when it is frontmost", () => {
  const jxa = keys({ stdin: "y", front: "Finder" });
  const r = jxa.osascript(["--front", "Terminal", "--enter"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(jxa.events[0], { type: "activate", app: "Terminal" });
  assert.equal(jxa.typed(), "y");
});

test("--front Terminal mismatch throws and presses nothing", () => {
  const jxa = keys({ stdin: "y", front: "Google Chrome", activates: false });
  assert.throws(
    () => jxa.call(["--front", "Terminal", "--enter"]),
    /^Error: keys: Terminal not frontmost \(Google Chrome\); typed nothing$/,
  );
  assert.deepEqual(presses(jxa), []);
  const r = keys({ stdin: "y", front: "Finder", activates: false }).osascript([
    "--front",
    "Terminal",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /keys: Terminal not frontmost \(Finder\)/);
});

test("--front Chrome types only while Google Chrome is frontmost, activating nothing", () => {
  const jxa = keys({ stdin: "", front: "Google Chrome" });
  assert.equal(jxa.call(["--front", "Chrome", "--enter"]), "keys: typed 0 characters, Enter");
  assert.deepEqual(presses(jxa), [{ type: "keyCode", code: 36 }]);
  assert.ok(!jxa.events.some((e) => e.type === "activate"));
  const other = keys({ stdin: "", front: "Terminal" });
  assert.throws(
    () => other.call(["--front", "Chrome", "--enter"]),
    /^Error: keys: Google Chrome not frontmost \(Terminal\); typed nothing$/,
  );
  assert.deepEqual(presses(other), []);
});

test("SecurityAgent success types one character, then the rest, then clicks Allow once", () => {
  const jxa = keys({ ...asking(1), stdin: `${SECRET}\n` });
  const r = jxa.osascript(SA);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    `keys: typed the secret (${SECRET.length} characters); clicked Allow; answered 1 SecurityAgent dialog\n`,
  );
  assert.deepEqual(
    presses(jxa).map((e) => (e.type === "keystroke" ? e.text.length : -1)),
    [1, SECRET.length - 1],
  );
  assert.deepEqual(clicks(jxa), [ALLOW]);
  assert.deepEqual(jxa.delays.slice(2), Array(10).fill(0.5), "waits 5 s for a repeat");
});

test("a repeat SecurityAgent dialog gets the same answer, and a third does not", () => {
  for (const asks of [2, 3]) {
    const jxa = keys({ ...asking(asks), stdin: `${SECRET}\n` });
    const r = jxa.osascript(SA);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(
      r.stdout,
      `keys: typed the secret (${SECRET.length} characters); clicked Allow; answered 2 SecurityAgent dialogs\n`,
    );
    assert.equal(jxa.typed(), SECRET + SECRET);
    assert.deepEqual(clicks(jxa), [ALLOW, ALLOW]);
  }
});

test("a dialog still up after Allow, or a repeat it cannot fill, stops without typing more", () => {
  const up = keys({ ...agent({ focused: true }), stdin: SECRET });
  const r = up.osascript(SA);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /keys: SecurityAgent dialog still up 5 s after Allow \(answered 1\); typed no more/,
  );
  assert.equal(up.typed(), SECRET);
  assert.deepEqual(clicks(up), [ALLOW]);
  const short = keys({ ...asking(2, { focused: true, accepts: 3 }), stdin: SECRET });
  const s = short.osascript(SA);
  assert.equal(s.code, 1);
  assert.match(
    s.stderr,
    new RegExp(
      `keys: answered 1 SecurityAgent dialog; the repeat: field has 3 characters, expected ${SECRET.length}; did not click Allow`,
    ),
  );
  assert.ok(!(s.stdout + s.stderr).includes(SECRET));
  assert.deepEqual(clicks(short), [ALLOW]);
});

test("a repeat dialog without its focused secure field is not answered", () => {
  const jxa = keys({ ...asking(2, { focused: false }), stdin: SECRET });
  const value = jxa.call(SA);
  assert.match(String(value), /; answered 1 SecurityAgent dialog$/);
  assert.equal(jxa.typed(), SECRET);
  assert.deepEqual(clicks(jxa), [ALLOW]);
});

test("--verify-field length mismatch does not click Allow", () => {
  const jxa = keys({ ...agent({ focused: true, accepts: 5 }), stdin: SECRET });
  assert.throws(
    () => jxa.call(["--front", "SecurityAgent", "--secret", "--verify-field"]),
    new RegExp(`keys: field has 5 characters, expected ${SECRET.length}; did not click Allow`),
  );
  assert.deepEqual(clicks(jxa), []);
});

test("--verify-field stops when the first character does not reach the field", () => {
  const jxa = keys({ ...agent({ focused: true, value: "xx", accepts: 0 }), stdin: SECRET });
  assert.throws(
    () => jxa.call(["--front", "SecurityAgent", "--secret", "--verify-field"]),
    /keys: first character did not reach the field; stopped/,
  );
  assert.equal(presses(jxa).length, 1);
  assert.deepEqual(clicks(jxa), []);
});

test("--front SecurityAgent refuses without the agent, its one field, focus or the front", () => {
  const cases: [Scene, RegExp][] = [
    [{ front: "Finder" }, /keys: no SecurityAgent; typed nothing/],
    [
      {
        front: "SecurityAgent",
        processes: [
          {
            name: "SecurityAgent",
            windows: [
              { fields: [{ subrole: "AXSecureTextField" }, { subrole: "AXSecureTextField" }] },
            ],
          },
        ],
      },
      /keys: SecurityAgent has 2 secure fields; typed nothing/,
    ],
    [agent({ focused: false }), /keys: SecurityAgent field not focused; typed nothing/],
    [agent({ focused: true }, "Finder"), /keys: SecurityAgent field not focused; typed nothing/],
  ];
  for (const [scene, error] of cases) {
    const jxa = keys({ ...scene, stdin: SECRET });
    assert.throws(
      () => jxa.call(["--front", "SecurityAgent", "--secret", "--verify-field"]),
      error,
    );
    assert.deepEqual(presses(jxa), []);
  }
});

test("SecurityAgent with no window refuses with the keys: prefix", () => {
  const jxa = keys({
    front: "SecurityAgent",
    processes: [{ name: "SecurityAgent" }],
    stdin: SECRET,
  });
  const r = jxa.osascript(["--front", "SecurityAgent", "--secret", "--verify-field"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Error: keys: SecurityAgent has no window; typed nothing/);
  assert.deepEqual(presses(jxa), []);
  assert.deepEqual(clicks(jxa), []);
});

test("--front SecurityAgent without --verify-field types the whole text", () => {
  const jxa = keys({ ...agent({ focused: true }), stdin: "pw" });
  jxa.call(["--front", "SecurityAgent", "--enter"]);
  assert.equal(jxa.typed(), "pw");
  assert.deepEqual(clicks(jxa), []);
});

test("--secret returns and throws nothing of the secret", () => {
  const ok = keys({ stdin: SECRET });
  const value = String(ok.call(["--secret", "--enter"]));
  assert.equal(value, "keys: typed the secret, Enter");
  assert.equal(ok.typed(), SECRET);
  const results = [
    keys({ stdin: SECRET, front: "Finder", activates: false }).osascript([
      "--front",
      "Terminal",
      "--secret",
    ]),
    keys({ ...agent({ focused: true, accepts: 3 }), stdin: SECRET }).osascript([
      "--front",
      "SecurityAgent",
      "--secret",
      "--verify-field",
    ]),
  ];
  for (const r of results) {
    assert.equal(r.code, 1);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET), r.stderr);
  }
});

test("a keystroke error is rethrown without the secret", () => {
  const jxa = keys({ stdin: SECRET, keystrokeError: `not allowed to send keystrokes: ${SECRET}` });
  const r = jxa.osascript(["--secret"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /keys: typing failed; the secret may be partly typed/);
  assert.ok(!r.stderr.includes(SECRET));
  const plain = keys({ stdin: "x", keystrokeError: "not allowed" }).osascript([]);
  assert.match(plain.stderr, /not allowed/);
});

test("empty secret throws", () => {
  const jxa = keys({ stdin: "\n" });
  assert.throws(() => jxa.call(["--secret", "--enter"]), /keys: empty secret; typed nothing/);
  assert.deepEqual(presses(jxa), []);
});

test("--wake presses Shift and waits before typing", () => {
  const jxa = keys({ stdin: "pw" });
  jxa.call(["--wake", "--secret", "--enter"]);
  assert.deepEqual(presses(jxa)[0], { type: "keyCode", code: 56 });
  assert.equal(jxa.delays[0], 1.5);
  assert.equal(jxa.typed(), "pw");
});

test("bad options are usage errors and press nothing", () => {
  for (const argv of [
    ["--bogus"],
    ["--front"],
    ["--front", "Finder"],
    ["--verify-field"],
    ["--front", "Terminal", "--verify-field"],
    ["--front", "Chrome", "--verify-field"],
    ["--front", "System Settings"],
  ]) {
    const jxa = keys({ stdin: "x", front: "Terminal" });
    assert.throws(() => jxa.call(argv), /keys: usage: keys /, argv.join(" "));
    assert.deepEqual(presses(jxa), []);
  }
});

test("only keys and private browser auth read stdin", () => {
  const dir = path.join(REPO, "mini/ts");
  const readers = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .filter((f) =>
      fs.readFileSync(path.join(dir, f), "utf8").includes("fileHandleWithStandardInput"),
    );
  assert.deepEqual(readers, ["chrome.ts", "keys.ts"]);
});

test("the committed mini/js/keys.js answers a repeat SecurityAgent dialog like its source", () => {
  const jxa = Jxa.compiled("keys", { ...asking(2), stdin: "pw" });
  const value = jxa.call(SA);
  assert.equal(
    value,
    "keys: typed the secret (2 characters); clicked Allow; answered 2 SecurityAgent dialogs",
  );
});

test("the committed mini/js/keys.js runs like its source", () => {
  const jxa = Jxa.compiled("keys", { stdin: "ab\r\n", front: "Terminal" });
  assert.equal(jxa.call(["--front", "Terminal", "--enter"]), "keys: typed 2 characters, Enter");
  assert.equal(jxa.typed(), "ab");
});

function settings(field: Field, front = "System Settings"): Scene {
  return {
    front,
    processes: [
      {
        name: "System Settings",
        windows: [
          { name: "Software Update", fields: [{ subrole: "AXTextField" }] },
          { buttons: ["Cancel", "OK"], fields: [{ subrole: "AXSecureTextField", ...field }] },
        ],
      },
    ],
  };
}

test("SettingsSheet types one character, then the rest, then clicks OK on the sheet", () => {
  const jxa = keys({ ...settings({ focused: true }), stdin: `${SECRET}\n` });
  const r = jxa.osascript(["--front", "SettingsSheet", "--secret", "--verify-field"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `keys: typed the secret (${SECRET.length} characters); clicked OK\n`);
  assert.deepEqual(
    presses(jxa).map((e) => (e.type === "keystroke" ? e.text.length : -1)),
    [1, SECRET.length - 1],
  );
  assert.deepEqual(clicks(jxa), [{ type: "click", process: "System Settings", button: "OK" }]);
});

test("SettingsSheet refuses unless System Settings is frontmost with a focused secure field", () => {
  const plain: Scene = {
    front: "System Settings",
    processes: [{ name: "System Settings", windows: [{ fields: [{ focused: true }] }] }],
  };
  const cases: [Scene, RegExp][] = [
    [settings({ focused: true }, "Finder"), /keys: System Settings not frontmost \(Finder\)/],
    [settings({ focused: false }), /keys: System Settings has no focused secure field/],
    [plain, /keys: System Settings has no focused secure field; typed nothing/],
    [{ front: "System Settings" }, /keys: System Settings has no focused secure field/],
  ];
  for (const [scene, error] of cases) {
    const jxa = keys({ ...scene, stdin: SECRET });
    const r = jxa.osascript(["--front", "SettingsSheet", "--secret", "--verify-field"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, error);
    assert.ok(!r.stderr.includes(SECRET));
    assert.deepEqual(presses(jxa), []);
    assert.deepEqual(clicks(jxa), []);
  }
});

test("SettingsSheet with a short field does not click OK", () => {
  const jxa = keys({ ...settings({ focused: true, accepts: 4 }), stdin: SECRET });
  assert.throws(
    () => jxa.call(["--front", "SettingsSheet", "--secret", "--verify-field"]),
    new RegExp(`keys: field has 4 characters, expected ${SECRET.length}; did not click OK`),
  );
  assert.deepEqual(clicks(jxa), []);
});

test("SettingsSheet without --verify-field types the whole text and clicks nothing", () => {
  const jxa = keys({ ...settings({ focused: true }), stdin: "pw" });
  assert.equal(jxa.call(["--front", "SettingsSheet", "--secret"]), "keys: typed the secret");
  assert.equal(jxa.typed(), "pw");
  assert.deepEqual(clicks(jxa), []);
});

test("the committed mini/js/keys.js handles SettingsSheet like its source", () => {
  const jxa = Jxa.compiled("keys", { ...settings({ focused: true }), stdin: "pw" });
  const value = jxa.call(["--front", "SettingsSheet", "--secret", "--verify-field"]);
  assert.equal(value, "keys: typed the secret (2 characters); clicked OK");
});
