const UNCHANGED =
  'test -z "$(git status --porcelain --untracked-files=all)" || { git status --short; exit 1; }';

const workflow = (overrides: { header?: string[]; jobs: string[] }) =>
  [
    ...(overrides.header ?? [
      "name: test",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: [main]",
      "concurrency:",
      "  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
      "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      "permissions:",
      "  contents: read",
    ]),
    "jobs:",
    ...overrides.jobs,
    "",
  ].join("\n");

const testJob = [
  "  test:",
  "    runs-on: ubuntu-24.04",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@x # v7",
  "        with:",
  "          persist-credentials: false",
  "      - run: chmod -R a-w ctl mini plugin",
  "      - run: npm test",
  "      - name: Require unchanged checkout",
  `        run: '${UNCHANGED.replace(/'/g, "''")}'`,
];
const fetchJob = [
  "  fetch:",
  "    runs-on: ubuntu-24.04",
  "    timeout-minutes: 10",
  "    steps:",
  "      - run: |",
  "          curl -fsSL -o x.tar.gz https://example.com/x.tar.gz",
  '          echo "abc  x.tar.gz" | sha256sum -c -',
];
const ciJob = [
  "  ci:",
  "    name: CI",
  "    needs: [test, fetch]",
  "    if: always()",
  "    runs-on: ubuntu-24.04",
  "    timeout-minutes: 5",
  "    steps:",
  "      - if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')",
  "        run: exit 1",
];
const shipped = {
  "mini/bin/x": "#!/bin/zsh\n",
  "ctl/lib/y.zsh": "f() {}\n",
  "plugin/skills/run/SKILL.md": "# run\n",
};

export const violation = {
  ...shipped,
  ".github/workflows/ci.yml": workflow({
    header: [
      "on:",
      "  push:",
      "    branches: [dev]",
      "permissions:",
      "  contents: write",
      "  pull-requests: write",
    ],
    jobs: [
      "  test:",
      "    runs-on: ubuntu-24.04",
      "    timeout-minutes: 30",
      "    permissions:",
      "      id-token: write",
      "    env:",
      "      TOKEN: ${{ secrets.TOKEN }}",
      "      OTHER: ${{ secrets['OTHER'] }}",
      "    steps:",
      "      - uses: actions/checkout@x # v7",
      "      - run: chmod -R a-w mini",
      "      - run: npm test",
      "  other:",
      "    runs-on: ubuntu-24.04",
      "    steps:",
      "      - run: echo",
      "      - run: curl -fsSL https://example.com/x.tar.gz -o x.tar.gz",
      "      - run: npm run coverage",
      "  host:",
      "    runs-on: ubuntu-24.04",
      "    timeout-minutes: 10",
      "    steps:",
      "      - run: node --test --test-concurrency=1 'tests/host/**/*.test.ts'",
      "  ci:",
      "    name: CI",
      "    needs: [test]",
      "    runs-on: ubuntu-24.04",
      "    timeout-minutes: 5",
      "    steps:",
      "      - run: echo done",
    ],
  }),
};

export const clean = {
  ...shipped,
  ".github/workflows/ci.yml": workflow({ jobs: [...testJob, ...fetchJob, ...ciJob] }),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  ".github/workflows/ci.yml:1: does not run on pull_request",
  ".github/workflows/ci.yml:1: does not run on push to main",
  ".github/workflows/ci.yml:1: permissions must be exactly contents: read",
  ".github/workflows/ci.yml:1: a new push must cancel the PR's running workflow (concurrency)",
  ".github/workflows/ci.yml:14: references secrets",
  ".github/workflows/ci.yml:15: references secrets",
  ".github/workflows/ci.yml:1: job test sets its own permissions",
  ".github/workflows/ci.yml:1: job test needs timeout-minutes <= 15",
  ".github/workflows/ci.yml:1: job test checks out without persist-credentials: false",
  ".github/workflows/ci.yml:1: job test must end with the 'Require unchanged checkout' step",
  ".github/workflows/ci.yml:1: job test must run 'chmod -R a-w ctl mini plugin' before its tests",
  ".github/workflows/ci.yml:1: job other needs timeout-minutes <= 15",
  ".github/workflows/ci.yml:1: job other downloads without sha256sum -c",
  ".github/workflows/ci.yml:1: job other must run 'chmod -R a-w ctl mini plugin' before its tests",
  ".github/workflows/ci.yml:1: job host must run 'chmod -R a-w ctl mini plugin' before its tests",
  ".github/workflows/ci.yml:1: job CI must need every other job",
  ".github/workflows/ci.yml:1: job CI must run if: always()",
  ".github/workflows/ci.yml:1: job CI must fail when a needed job failed or was cancelled",
];
