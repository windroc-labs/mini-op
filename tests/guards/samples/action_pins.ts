const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

export const violation = {
  ".github/workflows/ci.yml": [
    "jobs:",
    "  a:",
    "    steps:",
    "      - uses: actions/checkout@v7",
    `      - uses: actions/setup-node@${SHA}`,
    `      - uses: actions/setup-python@${SHA.slice(0, 12)} # v7.0.0`,
    "      - uses: docker://alpine:3",
    "",
  ].join("\n"),
};

export const clean = {
  ".github/workflows/ci.yml": [
    "jobs:",
    "  a:",
    "    steps:",
    `      - uses: actions/checkout@${SHA} # v7.0.1`,
    "      - uses: ./.github/actions/local",
    `      - uses: docker://alpine@sha256:${"a".repeat(64)}`,
    "",
  ].join("\n"),
  "README.md": "uses: actions/checkout@v7 in prose is not a workflow\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  ".github/workflows/ci.yml:4: actions/checkout@v7 is not pinned to a 40-hex commit SHA",
  ".github/workflows/ci.yml:5: actions/setup-node@3d3c42e5aac5ba805825da76410c181273ba90b1 has no '# <tag>' comment",
  ".github/workflows/ci.yml:6: actions/setup-python@3d3c42e5aac5 is not pinned to a 40-hex commit SHA",
  ".github/workflows/ci.yml:7: docker://alpine:3 is not pinned to an image digest",
];
