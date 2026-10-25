const SHA = "a".repeat(64);
const tsv = (rows: string[][]) =>
  ["name\tversion\tplatform\tsha256\turl\tmember", ...rows.map((row) => row.join("\t"))].join(
    "\n",
  ) + "\n";
const URL = "https://github.com/o/t/releases/download/v1.2.3/t_linux_amd64";

export const violation = {
  "package.json": JSON.stringify({
    devDependencies: { typescript: "^6.0.3", prettier: "latest", yaml: "2.9" },
    dependencies: { x: "git+https://example.com/x.git" },
  }),
  ".node-version": "24\n",
  ".github/tools.tsv": tsv([
    ["t", "v1.2.3", "linux-x64", "abc", URL, "-"],
    ["u", "latest", "linux-x64", SHA, "https://example.com/u", "-"],
    ["v", "v2.0.0", "linux-x64", SHA, URL, "-"],
  ]),
  ".github/workflows/ci.yml": [
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/setup-python@x # v7",
    "        with:",
    "          python-version: '3.13'",
    "      - run: npm ci",
    "      - run: npx prettier --check .",
    "",
  ].join("\n"),
};

export const clean = {
  "package.json": JSON.stringify({ devDependencies: { typescript: "6.0.3" } }),
  "package-lock.json": "{}\n",
  ".node-version": "24.21.0\n",
  ".github/tools.tsv": tsv([["t", "v1.2.3", "linux-x64", SHA, URL, "-"]]),
  ".github/workflows/ci.yml": [
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-24.04",
    "    steps:",
    "      - uses: actions/setup-python@x # v7",
    "        with:",
    "          python-version: 3.13.15",
    "      - uses: actions/setup-node@x # v7",
    "        with:",
    "          node-version-file: .node-version",
    "      - run: npm ci --ignore-scripts",
    "",
  ].join("\n"),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "package.json:1: x git+https://example.com/x.git is not an exact version",
  "package.json:1: typescript ^6.0.3 is not an exact version",
  "package.json:1: prettier latest is not an exact version",
  "package.json:1: yaml 2.9 is not an exact version",
  "package.json:1: no package-lock.json pins the dependency tree",
  ".node-version:1: node is not pinned to an exact version",
  ".github/tools.tsv:2: t: sha256 is not 64 hex digits",
  ".github/tools.tsv:3: u: latest is not an exact version",
  ".github/tools.tsv:3: u: url is not a GitHub release download of the pinned version",
  ".github/tools.tsv:4: v: url is not a GitHub release download of the pinned version",
  ".github/workflows/ci.yml:3: uses 'latest'",
  ".github/workflows/ci.yml:1: python-version: 3.13 is not an exact version",
  ".github/workflows/ci.yml:1: npm ci without --ignore-scripts",
  ".github/workflows/ci.yml:1: unpinned install: npx prettier --check .",
];
