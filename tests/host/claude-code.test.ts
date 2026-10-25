import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fingerprint } from "../lib/image.ts";
import { REPO } from "../lib/sandbox.ts";

const KEY = fs.readFileSync(path.join(REPO, "host/claude-code.asc"), "utf8");
const DOCKERFILE = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");

test("claude-code.asc's fingerprint is the one the Dockerfile comment names", () => {
  const named = /fingerprint ([0-9A-F]{40})/.exec(DOCKERFILE)?.[1];
  assert.ok(named, "no fingerprint in host/Dockerfile");
  assert.equal(fingerprint(KEY), named);
});

test("a changed key gives another fingerprint", () => {
  const lines = KEY.split("\n");
  const i = lines.findIndex((line) => line.startsWith("mQ"));
  const body = lines[i + 1] ?? "";
  lines[i + 1] = (body[0] === "A" ? "B" : "A") + body.slice(1);
  assert.notEqual(fingerprint(lines.join("\n")), fingerprint(KEY));
});

test("text without a key block throws", () => {
  assert.throws(() => fingerprint("no key here\n"), /no PGP public key block/);
});
