import assert from "node:assert/strict";
import { test } from "node:test";
import { fromFiles, type RepoView } from "../lib/repo.ts";
import { VALUE_FORMS } from "../lib/ssh_config.ts";
import { guard } from "./address.ts";

const BASE = 'mini_host: ""\nmini_user: ""\nmini_port: 22\n';
const LOCAL = "/home/u/.mini-op/config.local.yaml";
const SAY = "say `mini` (~/.mini-op/config.local.yaml)";

function report(files: Record<string, string>, local?: string | null): string[] {
  const view: RepoView = { ...fromFiles({ "host/config.yaml": BASE, ...files }) };
  if (local !== undefined) view.local = { path: LOCAL, text: local };
  return guard.check(view).map((v) => `${v.file}:${v.line}: ${v.message}`);
}

test("the base must leave the address and account empty", () => {
  assert.deepEqual(report({ "host/config.yaml": "mini_host: 10.9.8.7\nmini_user: alice\n" }), [
    'host/config.yaml:1: mini_host must be "" here; set it in ~/.mini-op/config.local.yaml',
    'host/config.yaml:2: mini_user must be "" here; set it in ~/.mini-op/config.local.yaml',
  ]);
  assert.deepEqual(report({ "host/config.yaml": "mini_port: 22\n" }), [
    "host/config.yaml:1: no mini_host line",
    "host/config.yaml:1: no mini_user line",
  ]);
});

test("without a local file only the base is checked", () => {
  assert.deepEqual(report({ "a.md": "ssh alice@10.9.8.7\n" }), []);
});

test("the local file's address and account are found in committed files, status.md exempt", () => {
  const local = "mini_host: 10.9.8.7\nmini_user: alice\n";
  const files = {
    "a.md": "ssh to 10.9.8.7\nAlice's login\nmalice and alice_2 are others\n",
    "tests/a.test.ts": 'const u = "alice";\n',
    "status.md": "| Machine | alice@10.9.8.7 |\n",
  };
  assert.deepEqual(report(files, local), [
    `a.md:1: names the mini's address; ${SAY}`,
    `a.md:2: names the mini's account; ${SAY}`,
    `tests/a.test.ts:1: names the mini's account; ${SAY}`,
  ]);
});

test("every value form of the local file is read as the bare value", () => {
  for (const form of VALUE_FORMS) {
    const local = `mini_host: ${form.replace("x", "10.9.8.7")}\nmini_user: ${form.replace("x", "alice")}\n`;
    assert.deepEqual(
      report({ "a.md": "alice at 10.9.8.7\n" }, local),
      [`a.md:1: names the mini's address; ${SAY}`, `a.md:1: names the mini's account; ${SAY}`],
      form,
    );
  }
});

test("an unreadable, malformed or incomplete local file fails the guard", () => {
  assert.deepEqual(report({}, null), [`${LOCAL}:1: cannot read it`]);
  assert.deepEqual(report({}, "mini_host: 10.9.8.7\n  mini_user: alice\n"), [
    `${LOCAL}:2: not a key: value line; run host/config`,
  ]);
  assert.deepEqual(report({}, 'mini_host: ""\n'), [
    `${LOCAL}:1: mini_host is empty`,
    `${LOCAL}:1: mini_user is empty`,
  ]);
});

test("messages never print the values", () => {
  const out = report({ "a.md": "alice 10.9.8.7\n" }, "mini_host: 10.9.8.7\nmini_user: alice\n");
  assert.equal(out.length, 2);
  for (const line of out)
    assert.ok(!/alice|10\.9\.8\.7/.test(line.slice(line.indexOf(": "))), line);
});
