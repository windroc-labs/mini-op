import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { containerToRepo, PLUGIN_ROOT, REPO } from "../../lib/repo.ts";

// /mini-op:run is plugin mini-op's skill run; the image bakes plugin/ under ROOT (FR-209).
const ROOT = `${PLUGIN_ROOT}/`;
const read = (file: string) => fs.readFileSync(path.join(REPO, file), "utf8");
const skill = () => read("plugin/skills/run/SKILL.md");
const SECTIONS = [
  "Rules",
  "Driving the mini",
  "Browser",
  "Waiting and answering",
  "Scripts",
  "Gotchas",
];

// The version is optional: host/Dockerfile stamps mini-op's commit into the image's copy.
test("plugin.json names the plugin mini-op with a description; a version is optional", () => {
  const manifest = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
  assert.equal(manifest.name, "mini-op");
  if ("version" in manifest) assert.match(manifest.version, /^\S+$/);
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
    const file = containerToRepo(ROOT + rest);
    assert.ok(typeof file === "string", `${ROOT}${rest} is not in the image's plugin root`);
    const repo = file.replace(/\/$/, "");
    assert.ok(fs.existsSync(path.join(REPO, repo)), `${ROOT}${rest}: no ${repo} in the repo`);
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

test("the connectivity runbook is read-only: ssh mini echo ok and mini sync --check only", () => {
  const text = read("runbooks/check-connection.md");
  assert.match(text, /^---\nwhen: \S.*\n---\n/);
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
  assert.ok(spans.includes("ssh mini echo ok"));
  assert.ok(spans.includes(`${ROOT}ctl/mini sync --check`));
  assert.doesNotMatch(text, /mini sync(?! --check)/);
  assert.match(read("ctl/CLAUDE.md"), /^\| [^|]+ \| `runbooks\/check-connection\.md` \|$/m);
});

test("the plugin has one skill", () => {
  assert.deepEqual(fs.readdirSync(path.join(REPO, "plugin/skills")), ["run"]);
});

test("the skill reads CLAUDE.md and the README sections before the lookup", () => {
  const text = skill();
  const readme = read("README.md");
  for (const named of ["CLAUDE.md", "README.md"]) assert.ok(text.includes(ROOT + named), named);
  for (const section of SECTIONS) {
    assert.ok(text.includes(section), `the skill does not name README › ${section}`);
    assert.match(readme, new RegExp(`^#{2,3} ${section}$`, "m"), `README has no ${section}`);
  }
  assert.ok(text.indexOf(`${ROOT}README.md`) < text.indexOf(`${ROOT}ctl/runbook`));
});

test("the skill finds the runbook in order with ctl/runbook", () => {
  const text = skill().slice(skill().indexOf("Find the runbook"));
  const order = [
    "steps inline",
    `${ROOT}ctl/runbook path <name>`,
    `${ROOT}ctl/runbook list`,
    "one-off runbook",
  ];
  const at = order.map((s) => text.indexOf(s));
  assert.ok(
    at.every((i) => i >= 0),
    `missing one of ${order.join(", ")}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  assert.match(text, /--project <project>/);
  assert.match(text, /`when` values alone/);
  assert.match(text, /open only the chosen runbook/);
  assert.match(text, /Exit 3[^\n]*ask the user which project[^\n]*run nothing/);
  assert.match(text, /no runbook named <name>/);
  assert.match(text, /Exit 2 means a malformed call/);
});

test("every result names the runbook's source and path", () => {
  const text = skill();
  for (const line of [
    "`Runbook: inline (request)`",
    "`Runbook: plugin <path>`",
    "`Runbook: project:<name> <path>`",
    "`Runbook: one-off (full text below)`",
  ]) {
    assert.ok(text.includes(line), `no ${line}`);
  }
  assert.match(text, /success or failure/);
  assert.match(text, /`runbook: skipped …`/);
  assert.match(text, /full text in a fenced block/);
});

test("README lists the plugin's marketplace and requirements, and the runbook lookup", () => {
  const readme = read("README.md");
  const row = readme.split("\n").find((line) => line.startsWith("| `plugin/` |")) ?? "";
  for (const fact of [
    "marketplace `windroc`",
    "`windroc-labs/agent-plugins-marketplace`",
    "access to `windroc/mini-op`",
    "only in the mini-op image",
  ]) {
    assert.ok(row.includes(fact), `README › Layout's plugin/ row does not say ${fact}`);
  }
  const scripts = readme.split("\n").find((line) => line.startsWith("| `ctl/runbook ")) ?? "";
  assert.ok(scripts.includes("`ctl/runbook -h`"), "README › Scripts' ctl/runbook row has no -h");
  assert.ok(
    !scripts.includes("<workspace>/projects/"),
    "the snapshot rules live in ctl/runbook -h",
  );
});

// FR-213, FR-214: the toolset is synced, then a project runbook's scripts go to the mini, then it runs.
test("the skill deploys a project runbook after the sync check and before running it", () => {
  const text = skill();
  const order = [
    `${ROOT}ctl/mini sync --check`,
    "Find the runbook",
    `${ROOT}ctl/runbook deploy <name>`,
    "Do the request",
  ];
  const at = order.map((s) => text.indexOf(s));
  assert.ok(
    at.every((i) => i >= 0),
    `missing one of ${order.join(", ")}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  const step = text.slice(text.lastIndexOf("\n", at[2]), at[3]);
  assert.match(step, /`project:<name>`/);
  assert.match(step, /non-0[^\n]*run nothing/);
  assert.match(step, /~\/mini-op-projects\/<project>\/<name>\//);
  assert.match(step, /unreviewed/);
  assert.match(step, /`~\/apm\/bin\/\*` and `~\/apm\/lib\/\*\.zsh`[^\n]*not enforced/);
});
