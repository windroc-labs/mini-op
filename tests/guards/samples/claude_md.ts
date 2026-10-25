const docs = {
  "README.md":
    "# mini-op\n\n## Rules\n\nSecrets never appear in output, argv, env or logs at any time.\n",
  "host/README.md": "# host\n\nThe container runs as the op user with its own ssh key.\n",
  "runbooks/install.md": [
    "# Install",
    "",
    "1. Always wait for the prompt to come back before you type anything else.",
    "",
  ].join("\n"),
};

const rules = (n: number) =>
  Array.from({ length: n }, (_, i) => `${i + 1}. Rule number ${i + 1} holds.`);

export const violation = {
  ...docs,
  "ctl/CLAUDE.md": [
    "# mini-op",
    "Read this first.",
    "",
    "## Routes",
    "",
    "| Task | File |",
    "| --- | --- |",
    "| Install tests | `runbooks/install.md` |",
    "| WAIT for the prompt to come back, before you type anything | `runbooks/install.md` |",
    "| Hosts | the proxy's README |",
    "| Ans | `~/apm/bin/ans` |",
    "| Container | `host/README.md` › Steps. The container runs as the op user with its own ssh key. |",
    "",
    "## Hard rules",
    "",
    ...rules(9),
    "- And a bullet.",
    "",
    "### More",
    "More text.",
    "",
  ].join("\n"),
};

export const clean = {
  ...docs,
  "ctl/CLAUDE.md": [
    "# mini-op",
    "",
    "## Routes",
    "",
    "| Task | Read |",
    "| --- | --- |",
    "| Install tests, reruns and upgrades in place for the agent | `runbooks/install.md` |",
    "| Wait for the prompt to come back | `runbooks/install.md` › Install |",
    "| Hosts | `host/README.md` |",
    "",
    "## Hard rules",
    "",
    "1. Secrets never appear in output, argv, env or logs at any time.",
    ...rules(8).slice(1),
    "",
  ].join("\n"),
};

const outside = "not a route or a hard rule: ctl/CLAUDE.md holds only those (FR-73)";
const noFile = "route names no repo file: its Read cell is `<file>` or `<file>` › <heading>";
const copies = (file: string, words: string) =>
  `repeats ${file}: "${words}"; route to it instead (FR-74)`;

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `ctl/CLAUDE.md:2: ${outside}`,
  "ctl/CLAUDE.md:6: the routes table's header is not `| Task | Read |`",
  `ctl/CLAUDE.md:9: ${copies("runbooks/install.md", "wait for the prompt to come back before you type anything")}`,
  `ctl/CLAUDE.md:10: ${noFile}`,
  `ctl/CLAUDE.md:11: ${noFile}`,
  `ctl/CLAUDE.md:12: ${copies("host/README.md", "the container runs as the op user with its own ssh key")}`,
  "ctl/CLAUDE.md:24: more than 8 hard rules (FR-74)",
  `ctl/CLAUDE.md:25: ${outside}`,
  `ctl/CLAUDE.md:27: ${outside}`,
  `ctl/CLAUDE.md:28: ${outside}`,
];
