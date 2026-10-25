import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT,
  FAKE_LOCAL,
  FAKE_SSH_CONFIG,
  hostMini,
  MINI_HOST,
  MINI_USER,
} from "./ssh_config.ts";

test("hostMini reads HostName and the first User under Host mini, as ssh does", () => {
  const text =
    "# the mini\nUser outside\nHost other\n    HostName 10.0.0.1\n    User nobody\n" +
    "host  backup mini\n    hostname 10.9.8.7\n    User alice_2\n    User bob\nHost *\n    User star\n";
  assert.deepEqual(hostMini(text), { hostName: "10.9.8.7", user: "alice_2" });
});

test("hostMini leaves out a missing or invalid User", () => {
  assert.deepEqual(hostMini("Host mini\n    HostName 10.9.8.7\n"), { hostName: "10.9.8.7" });
  assert.deepEqual(hostMini("Host other\n    User alice\n"), {});
  for (const user of ["../x", "A.b", "x;y"]) {
    assert.deepEqual(hostMini(`Host mini\n    User ${user}\n    User ok\n`), {}, user);
  }
});

test("the fake config is valid: a private address and a plain account", () => {
  assert.equal(MINI_USER, "tester");
  assert.equal(MINI_HOST, "10.9.8.7");
  assert.match(MINI_USER, ACCOUNT);
  assert.deepEqual(hostMini(FAKE_SSH_CONFIG), { hostName: MINI_HOST, user: MINI_USER });
  assert.equal(FAKE_LOCAL, `mini_host: ${MINI_HOST}\nmini_user: ${MINI_USER}\n`);
});
