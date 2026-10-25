import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { dockerfileProblems } from "../lib/image.ts";
import { REPO } from "../lib/sandbox.ts";

const TEXT = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");

test("the mini-op Dockerfile pins its base by digest and claude-code by exact version", () => {
  assert.deepEqual(dockerfileProblems(TEXT), []);
});

test("the image installs no python3 (FR-68)", () => {
  const install = /apt-get install -y --no-install-recommends \\\n([^;]+);/.exec(TEXT)?.[1] ?? "";
  assert.match(install, /claude-code=/);
  assert.doesNotMatch(install, /\bpython/);
});

test("a FROM without a digest fails", () => {
  const text = TEXT.replace(/^FROM (\S+)@sha256:[0-9a-f]{64}/m, "FROM $1");
  assert.match(dockerfileProblems(text).join("\n"), /FROM .* is not pinned by digest/);
});

test("a claude-code version range or a missing pin fails", () => {
  const range = TEXT.replace(/^ARG CLAUDE_CODE_VERSION=.*$/m, "ARG CLAUDE_CODE_VERSION=2.1.*");
  assert.match(dockerfileProblems(range).join("\n"), /CLAUDE_CODE_VERSION .* is not exact/);
  const unpinned = TEXT.replace('"claude-code=${CLAUDE_CODE_VERSION}"', "claude-code");
  assert.match(dockerfileProblems(unpinned).join("\n"), /claude-code is not installed at/);
});
