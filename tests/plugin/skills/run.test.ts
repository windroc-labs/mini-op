import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { containerToRepo, PLUGIN_ROOT, REPO } from "../../lib/repo.ts";

// /mini-op:run is plugin mini-op's skill run; the image bakes plugin/ under ROOT (FR-209).
const ROOT = `${PLUGIN_ROOT}/`;
const read = (file: string) => fs.readFileSync(path.join(REPO, file), "utf8");
const skill = () => read("plugin/skills/run/SKILL.md");

test("plugin.json names the plugin mini-op, with a version and a description", () => {
  const manifest = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
  assert.equal(manifest.name, "mini-op");
  assert.match(manifest.version, /^\S+$/);
  assert.match(manifest.description, /\S/);
});

test("SKILL.md's frontmatter names the skill run and describes it", () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill())?.[1];
  assert.ok(front, "no frontmatter");
  const fields = Object.fromEntries(
    front.split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  assert.equal(fields.name, "run");
  assert.match(fields.description ?? "", /\S/);
});

test("the skill names its rules and tools by absolute plugin-root paths to repo files", () => {
  const text = skill();
  for (const named of ["CLAUDE.md", "ctl/mini sync --check", "ctl/mini sync`"]) {
    assert.ok(text.includes(ROOT + named), `the skill does not name ${ROOT}${named}`);
  }
  const paths = [...text.matchAll(/\/opt\/windroc\/plugins\/mini-op\/([\w./-]*)/g)];
  assert.ok(paths.length > 0);
  for (const [, rest] of paths) {
    const file = (containerToRepo(ROOT + rest) ?? "").replace(/\/$/, "");
    assert.ok(fs.existsSync(path.join(REPO, file)), `${ROOT}${rest}: no ${file} in the repo`);
  }
  for (const match of text.matchAll(/(?<![\w.-])(?:\.\.?\/)?(?:ctl|mini|runbooks)\/[\w./-]*/g)) {
    const before = text.slice(0, match.index);
    assert.ok(before.endsWith(ROOT), `relative path ${match[0]} in the skill`);
  }
});

test("the skill relies on no PATH, working directory or /home/agent", () => {
  const text = skill();
  const subs = [...read("ctl/mini").matchAll(/^mini ([a-z][a-z-]*)/gm)].map((m) => m[1]);
  assert.ok(subs.includes("sync"));
  const bare = new RegExp(`(?<![\\w/.-])(?:mini (?:${subs.join("|")})\\b|mini-autologin)`, "g");
  assert.deepEqual([...text.matchAll(bare)].map(String), []);
  assert.doesNotMatch(text, /\/home\/agent|\bPATH\b|\bcwd\b/);
});
