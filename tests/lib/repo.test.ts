import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { BAKED, containerToRepo, PLUGIN_ROOT, REPO } from "./repo.ts";

const at = (rest: string) => `${PLUGIN_ROOT}/${rest}`;

test("containerToRepo: undefined outside the plugin root, '' for the root itself", () => {
  for (const file of ["/opt/windroc/plugins", `${PLUGIN_ROOT}x/ctl`, "ctl/mini", "/etc/ssh"]) {
    assert.equal(containerToRepo(file), undefined, file);
  }
  assert.equal(containerToRepo(PLUGIN_ROOT), "");
  assert.equal(containerToRepo(`${PLUGIN_ROOT}/`), "");
});

test("containerToRepo: a baked entry maps to the repo path the image takes it from", () => {
  const cases: [string, string][] = [
    ["CLAUDE.md", "ctl/CLAUDE.md"],
    ["README.md", "README.md"],
    ["ctl", "ctl"],
    ["ctl/", "ctl/"],
    ["ctl/mini", "ctl/mini"],
    ["ctl/lib/ssh.zsh", "ctl/lib/ssh.zsh"],
    ["mini/bin", "mini/bin"],
    ["runbooks/setup-test-env.md", "runbooks/setup-test-env.md"],
    ["skills", "plugin/skills"],
    ["skills/run/SKILL.md", "plugin/skills/run/SKILL.md"],
    [".claude-plugin/plugin.json", "plugin/.claude-plugin/plugin.json"],
  ];
  for (const [rest, repo] of cases) assert.equal(containerToRepo(at(rest)), repo, rest);
});

test("containerToRepo: anything else under the root, by whole path component, is null", () => {
  for (const rest of [
    "status.md",
    "host/README.md",
    "ctl/CLAUDE.md",
    "plugin/skills",
    "skillsfoo",
    "skillsfoo/run/SKILL.md",
    ".claude-pluginX",
    "ctlx/mini",
    "README.md.bak",
  ]) {
    assert.equal(containerToRepo(at(rest)), null, rest);
  }
});

test("the baked entries are host/Dockerfile's plugin-root COPY sources, plugin/'s top level and its moves", () => {
  const text = fs.readFileSync(path.join(REPO, "host/Dockerfile"), "utf8");
  const image = text.slice(0, text.search(/^FROM image AS env$/m));
  const found = new Map<string, string>();
  for (const [, source = "", dest = ""] of image.matchAll(/^COPY (\S+) (\S+)$/gm)) {
    if (!dest.startsWith(`${PLUGIN_ROOT}/`)) continue;
    const from = source.replace(/\/$/, "");
    const into = dest.slice(PLUGIN_ROOT.length + 1).replace(/\/$/, "");
    if (into) {
      found.set(into, from);
    } else if (source.endsWith("/")) {
      for (const entry of fs.readdirSync(path.join(REPO, from))) {
        found.set(entry, `${from}/${entry}`);
      }
    } else {
      found.set(path.basename(from), from);
    }
  }
  // A move inside the root to its top level: the moved entry is baked there, not at its source.
  for (const [, source = "", dest = ""] of image.matchAll(/\bmv (\S+) ([^\s/;]+);/g)) {
    const [top = "", ...below] = source.split("/");
    const from = found.get(top);
    if (from === undefined || below.length === 0) continue;
    found.set(dest, [from, ...below].join("/"));
  }
  assert.deepEqual([...found].sort(), [...BAKED].sort());
  for (const repo of BAKED.values()) assert.ok(fs.existsSync(path.join(REPO, repo)), repo);
});
