import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox } from "../lib/sandbox.ts";

// One standard skill drives the separately installed runtime.
const ROOT = "<root>/";
const read = (file: string) => fs.readFileSync(path.join(REPO, file), "utf8");
const skill = () => read("skills/mini-op/SKILL.md");
const SECTIONS = [
  "Rules",
  "Driving the mini",
  "Browser",
  "Waiting and answering",
  "Scripts",
  "Gotchas",
];

test("there is one standalone skill and no plugin manifest", () => {
  assert.deepEqual(fs.readdirSync(path.join(REPO, "skills")), ["mini-op"]);
  assert.equal(fs.existsSync(path.join(REPO, "plugin/.claude-plugin/plugin.json")), false);
  assert.doesNotMatch(skill(), /plugins?\/|mini-op:run|\$ARGUMENTS|allowed-tools:/);
});

test("SKILL.md's frontmatter names the skill mini-op and describes it", () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill())?.[1];
  assert.ok(front, "no frontmatter");
  const fields = Object.fromEntries(
    front.split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  assert.equal(fields.name, "mini-op");
  assert.match(fields.description ?? "", /\S/);
});

test("the skill discovers and verifies a separate absolute runtime root", () => {
  const text = skill();
  assert.match(text, /command -v mini/);
  assert.match(text, /Resolve symlinks/);
  assert.match(text, /ask for the checkout's absolute path and run nothing/);
  assert.match(text, /quote paths as shell arguments/);
  assert.match(text, /retain the client's current project directory/);
  assert.match(text, /separately installed mini-op CLI/);
  assert.match(text, /never by a bare name/);
  for (const named of ["ctl/mini", "ctl/runbook", "README.md", "mini/", "runbooks/", "runbooks/visible-operations.md"]) {
    assert.ok(text.includes(ROOT + named), named);
    assert.ok(fs.existsSync(path.join(REPO, named)), named);
  }
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

test("every runtime path in the skill's Run section is root-prefixed and exists", () => {
  const start = skill().indexOf("\n## Run\n");
  assert.ok(start >= 0, "missing Run section");
  const text = skill().slice(start);
  const paths = [...text.matchAll(/(?<![\w.-])(?:\.\.?\/)?(?:ctl|mini|runbooks)\/[\w./-]*/g)];
  assert.ok(paths.length > 0, "no runtime paths in Run");
  for (const match of paths) {
    const before = text.slice(0, match.index);
    assert.ok(before.endsWith(ROOT), `relative path ${match[0]} in the skill`);
    assert.ok(fs.existsSync(path.join(REPO, match[0])), `${match[0]} does not exist in the repo`);
  }
});

test("the skill reads CLAUDE.md and the README sections before the lookup", () => {
  const text = skill().slice(skill().indexOf("\n## Run\n"));
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
    "`Runbook: builtin <path>`",
    "`Runbook: project:<name> <path>`",
    "`Runbook: one-off (full text below)`",
  ]) {
    assert.ok(text.includes(line), `no ${line}`);
  }
  assert.match(text, /success or failure/);
  assert.match(text, /`runbook: skipped …`/);
  assert.match(text, /full text in a fenced block/);
});

test("README cites the official client skill directories and runtime prerequisites", () => {
  const text = read("README.md");
  for (const dir of [
    "~/.claude/skills/mini-op/",
    ".claude/skills/mini-op/",
    "~/.agents/skills/mini-op/",
    ".agents/skills/mini-op/",
    "~/.config/opencode/skills/mini-op/",
    ".opencode/skills/mini-op/",
  ]) {
    assert.ok(text.includes("`" + dir + "`"), dir);
  }
  for (const url of [
    "https://code.claude.com/docs/en/skills",
    "https://learn.chatgpt.com/docs/build-skills",
    "https://opencode.ai/docs/skills/",
  ])
    assert.ok(text.includes(url), url);
  assert.match(text, /runtime is a separate prerequisite/);
  assert.ok(text.includes("`/etc/claude-code/.claude/skills/mini-op/`"));
  assert.doesNotMatch(text, /\/plugin install|plugins = \["mini-op"\]|mini-op:run/);
});

test("README keeps the runbook lookup details in ctl/runbook -h", () => {
  const readme = read("README.md");
  const scripts = readme.split("\n").find((line) => line.startsWith("| `ctl/runbook ")) ?? "";
  assert.ok(scripts.includes("`ctl/runbook -h`"), "README › Scripts' ctl/runbook row has no -h");
  assert.ok(
    !scripts.includes("<workspace>/projects/"),
    "the snapshot rules live in ctl/runbook -h",
  );
  const deploy = readme.split("\n").find((line) => line.startsWith("| `ctl/runbook deploy ")) ?? "";
  assert.ok(deploy.includes("details: `ctl/runbook -h`"), "README's deploy row points nowhere");
  assert.ok(!deploy.includes("~/mini-op-projects"), "deploy's behaviour lives in ctl/runbook -h");
  assert.ok(
    !readme.includes("convention, not a sandbox"),
    "the warning's homes are SKILL.md and host/README.md",
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

test("the documented Codex install copies the standalone skill into a temp HOME", async (t) => {
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  const install = /<!-- skill-install -->\s*```sh\n([\s\S]*?)\n```/.exec(readme)?.[1];
  assert.ok(install, "missing documented skill install");
  const sb = await Sandbox.create(t);
  const result = await sb.run(["sh", "-c", install], { cwd: REPO });
  assert.equal(result.code, 0, result.stderr);
  const installed = path.join(sb.home, ".agents/skills/mini-op");
  assert.deepEqual(fs.readdirSync(installed), ["SKILL.md"]);
  assert.equal(
    fs.readFileSync(path.join(installed, "SKILL.md"), "utf8"),
    fs.readFileSync(path.join(REPO, "skills/mini-op/SKILL.md"), "utf8"),
  );
  assert.deepEqual(sb.calls(), []);
  assert.deepEqual(sb.leaks({ consumers: [] }), []);
});
