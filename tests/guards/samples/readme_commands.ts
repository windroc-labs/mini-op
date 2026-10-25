const readme = (commands: string[]) =>
  ["# x", "", "## Offline checks", "", "```sh", ...commands, "```", ""].join("\n");
const workflow = [
  "jobs:",
  "  a:",
  "    steps:",
  "      - run: npm ci --ignore-scripts",
  "      - run: npm test",
  "",
].join("\n");
const pkg = (test: string) => JSON.stringify({ scripts: { test } });

export const violation = {
  "README.md": readme(["npm ci --ignore-scripts", "npm run bogus", "npm test"]),
  ".github/workflows/ci.yml": workflow,
  "package.json": pkg("node --test tests"),
};

export const clean = {
  "README.md": readme(["# install", "npm ci --ignore-scripts", "npm test"]),
  ".github/workflows/ci.yml": workflow,
  "package.json": pkg("node --test --test-timeout=60000 'tests/**/*.test.ts'"),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "README.md:1: `npm run bogus` is not a CI step run verbatim",
  "package.json:1: npm test must run node --test over 'tests/**/*.test.ts'",
];
