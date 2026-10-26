const script = "#!/bin/zsh\ntrue\n";
const base = {
  "README.md": "# x\n",
  "package.json": "{}\n",
  "tests/a.test.ts": "\n",
  ".github/workflows/ci.yml": "on: push\n",
  "runbooks/setup.md": "# setup\n",
  "mini/bin/ans": script,
  "mini/js/type.js": "function run() {}\n",
  "mini/js/page/field.js": "(function page() {})\n",
  "mini/lib/secrets.zsh": "f() {}\n",
  "mini/ts/keys.ts": "export {};\n",
  "mini/bin/lq": script,
  "ctl/mini": script,
  "ctl/CLAUDE.md": "# op\n",
  "ctl/lib/ssh.zsh": "f() {}\n",
  "host/start": "#!/usr/bin/env bash\n",
  "host/ssh_config": "Host mini\n",
  "host/proxy/acl.yaml": "x: 1\n",
  "skills/mini-op/SKILL.md": "# run\n",
};

export const violation = {
  ...base,
  "notes.md": "# stray\n",
  // status.md and the runbooks replaced the old playbook.
  "playbook.md": "# playbook\n",
  "scripts/ans": script,
  "runbooks/clean": script,
  "runbooks/sub/x.md": "# x\n",
  // Project runbooks and their mini scripts live in the project (.mini-op/runbooks/).
  "runbooks/test-board.toml": "x = 1\n",
  "mini/ans": script,
  "mini/js/type.ts": "export {};\n",
  "mini/js/page/sub/x.js": "x\n",
  "mini/runbooks/gone/lq": script,
  "ctl/notes.txt": "x\n",
  "ctl/sub/x": script,
  "host/proxy/a/b": "x\n",
  "skills/README.md": "# x\n",
  "skills/.claude-plugin/marketplace.json": "{}\n",
  "skills/SKILL.md": "# x\n",
  "skills/mini-op/notes.md": "# x\n",
};

export const clean = base;

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "notes.md:1: the root holds only docs and tool configs",
  "playbook.md:1: the root holds only docs and tool configs",
  "scripts/ans:1: scripts/ is not a layout dir (mini/, ctl/, host/, skills/, runbooks/, tests/)",
  "runbooks/clean:1: runbooks/ holds docs only",
  "runbooks/sub/x.md:1: runbooks/ holds docs only",
  "runbooks/test-board.toml:1: runbooks/ holds docs only",
  "mini/ans:1: mini/ holds bin/, js/*.js, js/page/*.js, lib/ and ts/",
  "mini/js/type.ts:1: mini/ holds bin/, js/*.js, js/page/*.js, lib/ and ts/",
  "mini/js/page/sub/x.js:1: mini/ holds bin/, js/*.js, js/page/*.js, lib/ and ts/",
  "mini/runbooks/gone/lq:1: mini/ holds bin/, js/*.js, js/page/*.js, lib/ and ts/",
  "ctl/notes.txt:1: ctl/ holds scripts, CLAUDE.md and lib/",
  "ctl/sub/x:1: ctl/ holds scripts, CLAUDE.md and lib/",
  "host/proxy/a/b:1: host/ holds its files and proxy/",
  "skills/README.md:1: skills/ holds <name>/SKILL.md",
  "skills/.claude-plugin/marketplace.json:1: skills/ holds <name>/SKILL.md",
  "skills/SKILL.md:1: skills/ holds <name>/SKILL.md",
  "skills/mini-op/notes.md:1: skills/ holds <name>/SKILL.md",
];
