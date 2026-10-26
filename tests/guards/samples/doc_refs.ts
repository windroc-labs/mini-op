// The docs every view needs; the violation lacks return-mini.md.
const runbooks = { "runbooks/setup-test-env.md": "# setup-test-env\n" };
const required = {
  ...runbooks,
  "runbooks/return-mini.md": "# return\n",
  "status.md": "# status\n",
};

const files = {
  ...runbooks,
  "mini/bin/ans": "#!/bin/zsh\n~/apm/bin/termwait 1 --after x; mkdir -p ~/apm/state/done\n",
  "mini/bin/termwait": "#!/bin/zsh\n",
  "mini/bin/lq": "#!/bin/zsh\n",
  "host/README.md": "Edit `proxy/acl.yaml`, then `../README.md`.\n",
  "host/proxy/acl.yaml": "x: 1\n",
  "plugin/.claude-plugin/plugin.json": "{}\n",
  "runbooks/setup.md": "Run `ssh mini '~/apm/bin/lq body'` (`../status.md`).\n",
  "status.md": [
    "# status",
    "",
    "## Machine (built 1)",
    "",
    "###### Deep ##",
    "",
    "```sh",
    "# Fenced",
    "```",
    "",
  ].join("\n"),
  // Subcommands and their options come from the usage lines starting `mini <sub>`, not from case
  // labels (chord) or continuation lines (--force).
  "ctl/mini": [
    "#!/bin/zsh",
    'usage="mini run [secs] [--to <id>]   type stdin and wait; not for secrets: use mini pw',
    "mini pw [--lock | --sa]       type the password",
    "mini sudo <command> [args]    run <command> with sudo; mini sudo -v checks the password",
    "mini sync [--check]           copy mini/ to the mini; --check exits 1 unless it matches",
    '                              --force is not an option"',
    "case $1 in",
    "  chord) ;;",
    "esac",
    "",
  ].join("\n"),
};

export const violation = {
  ...files,
  "README.md": [
    "See `runbooks/gone.md` and `mini/bin/tw`.",
    "Run `~/apm/ans` or `ssh mini '~/apm/lq'`; also ~/apm/type.js.",
    "Then `mini chord command 40`; the old `~/apm/.done/<id>`.",
    "Run `mini sync --bogus`, `mini pw --lock -x` and `mini sudo -k rm x`.",
    "Edit `plugin/.claude-plugin/gone.json` and `/opt/windroc/plugins/mini-op/skills/gone/SKILL.md`.",
    "Not baked: `/opt/windroc/plugins/mini-op/status.md`, `/opt/windroc/plugins/mini-op/skillsfoo`.",
    "",
  ].join("\n"),
  "ctl/CLAUDE.md": [
    "Read `runbooks/setup.md` and `../README.md`; `/opt/windroc/plugins/mini-op/scripts` is gone.",
    "Run `/opt/mini-op/ctl/mini sync`.",
    "| Task | `status.md` › Machine (built 2) |",
    "| Setup | `runbooks/setup.md` › setup |",
    "",
  ].join("\n"),
  "ctl/mini-x": "#!/bin/zsh\nssh mini '~/apm/shot'\n",
  "host/README.md": [
    "Check:",
    "",
    "   ```sh",
    "   mini synk --check",
    "   docker exec mini-op mini chord command 40; ~/playground/mini-op/ctl/mini nope x",
    "   mini sync --force && mini run --to x --bad",
    "   ```",
    "",
  ].join("\n"),
  "runbooks/setup.md": [
    "See `../status.md` › Fenced; `../status.md` › Machine.",
    "Not `../status.md` › status page, `status.md` › status; `../gone.md` › X.",
    "",
  ].join("\n"),
};

export const clean = {
  ...files,
  "runbooks/return-mini.md": "# return\n",
  "README.md": [
    "See `runbooks/setup.md`, `mini/bin/*` and `docs/credentials.md` (ensemble's).",
    "Run `ssh mini '~/apm/bin/ans 60'`, ~/apm/bin/<name>, `mini sync` and `mini pw`.",
    "The marker `~/apm/state/done/<id>`, the stamp `~/apm/VERSION`; `mini ~ %` is a prompt.",
    "Run `mini sync --check`, `mini sudo rm -rf x`, `mini sudo -v` and `mini run 5 --to 1-2-3`.",
    "Edit `plugin/.claude-plugin/plugin.json`, in the image",
    "`/opt/windroc/plugins/mini-op/.claude-plugin/plugin.json` in `/opt/windroc/plugins/mini-op/`.",
    "",
  ].join("\n"),
  "ctl/CLAUDE.md": [
    "Read `README.md`, `runbooks/setup.md`, `/opt/windroc/plugins/mini-op/CLAUDE.md`, `/opt/windroc/plugins/mini-op/mini/bin`, `/opt/windroc/plugins/mini-op/ctl/`, `/opt/windroc/plugins/mini-op/ctl/mini`.",
    "| Task | `status.md` › Machine (built 1) |",
    "| Other | `status.md` › Deep |",
    "",
  ].join("\n"),
  "tests/x.test.ts": "'~/apm/nothing'\n",
  "host/README.md": [
    "```sh",
    "mini sync --check",
    "docker exec mini-op mini sync && ctl/mini sync",
    "docker exec mini-op ssh mini hostname; ssh -F x mini 'cd ~/apm'",
    "mini pw --lock; mini pw --sa | mini run --to 1-2-3; mini sudo rm -rf /tmp/x",
    "```",
    "",
  ].join("\n"),
  "runbooks/setup.md": [
    "Run `ssh mini '~/apm/bin/lq body'` (`../status.md` › Machine (built 1)).",
    "| `../status.md` › status | `../status.md` › Deep, Machine (built 1) |",
    "See `../status.md` › status.",
    "",
  ].join("\n"),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "README.md:1: `runbooks/gone.md` does not exist",
  "README.md:1: `mini/bin/tw` does not exist",
  "README.md:2: ~/apm/ans is not mini/ans",
  "README.md:2: ~/apm/lq is not mini/lq",
  "README.md:2: ~/apm/type.js is not mini/type.js",
  "README.md:3: `mini chord`: ctl/mini has no chord subcommand",
  "README.md:3: ~/apm/.done is not mini/.done",
  "README.md:4: `mini sync --bogus`: ctl/mini's usage has no --bogus for mini sync",
  "README.md:4: `mini pw -x`: ctl/mini's usage has no -x for mini pw",
  "README.md:4: `mini sudo -k`: ctl/mini's usage has no -k for mini sudo",
  "README.md:5: `plugin/.claude-plugin/gone.json` does not exist",
  "ctl/CLAUDE.md:1: `../README.md` does not exist",
  "README.md:5: `/opt/windroc/plugins/mini-op/skills/gone/SKILL.md` does not exist",
  "README.md:6: `/opt/windroc/plugins/mini-op/status.md` is not in the image's plugin root",
  "README.md:6: `/opt/windroc/plugins/mini-op/skillsfoo` is not in the image's plugin root",
  "ctl/CLAUDE.md:1: `/opt/windroc/plugins/mini-op/scripts` is not in the image's plugin root",
  "ctl/CLAUDE.md:2: `/opt/mini-op/ctl/mini` is retired: the image's plugin root is /opt/windroc/plugins/mini-op",
  "ctl/CLAUDE.md:3: `status.md` › Machine (built 2): status.md has no such heading",
  "ctl/CLAUDE.md:4: `runbooks/setup.md` › setup: runbooks/setup.md has no such heading",
  "ctl/mini-x:2: ~/apm/shot is not mini/shot",
  "host/README.md:4: `mini synk`: ctl/mini has no synk subcommand",
  "host/README.md:5: `mini chord`: ctl/mini has no chord subcommand",
  "host/README.md:5: `mini nope`: ctl/mini has no nope subcommand",
  "host/README.md:6: `mini sync --force`: ctl/mini's usage has no --force for mini sync",
  "runbooks/setup.md:1: `../status.md` › Fenced: status.md has no such heading",
  "runbooks/setup.md:1: `../status.md` › Machine: status.md has no such heading",
  "runbooks/setup.md:2: `../status.md` › status page: status.md has no such heading",
  "runbooks/setup.md:2: `status.md` › status: runbooks/status.md does not exist",
  "runbooks/setup.md:2: `../gone.md` does not exist",
  "runbooks/return-mini.md:1: runbooks/return-mini.md is missing: README.md › Start here needs it",
];

// A ctl/mini without its `usage="…"` text: one violation there, not one per `mini <sub>` reference.
export const more = [
  {
    violation: {
      ...required,
      "ctl/mini":
        '#!/bin/zsh\nusage_error() { print -u2 -r -- "mini: usage: mini sync [--check]"; }\n',
      "mini/bin/ans": "#!/bin/zsh\n",
      "README.md": "Run `mini sync --check` and `mini pw`.\n",
    },
    expected: [
      'ctl/mini:1: no usage="…" text: doc_refs reads mini\'s subcommands and options from it',
    ],
  },
];
