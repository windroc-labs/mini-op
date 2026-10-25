const status = [
  "# Status",
  "",
  "## Current environment (built 2026-10-20)",
  "",
  "| Item | Value |",
  "|---|---|",
  "| Manager | key: mini keychain `ensemble-test-linear-key` / `ensemble-test` |",
  "| GitHub | password: mini keychain `ensemble-test-github` |",
  "",
  "## Status",
  "",
  "- removed `ensemble-old` / `x`",
  "",
].join("\n");

export const violation = {
  "status.md": status,
  "mini/runbooks/setup/lq": [
    "#!/usr/bin/env zsh",
    "keychain_read ensemble-test-linear-key other | curl -H @- u",
    "keychain_has ensemble-old x || exit 1",
    "security add-generic-password -U -s 'ensemble-new' -a alice -w x",
    "",
  ].join("\n"),
  "runbooks/setup.md": [
    "# Setup",
    "",
    "Then `keychain_read strata-api-key strata | ~/apm/bin/ans 120`.",
    "Store it: `~/apm/runbooks/setup-test-env/storekey ensemble-test-x a@b.c`.",
    "",
  ].join("\n"),
};

export const clean = {
  "status.md": status,
  "mini/runbooks/setup/lq": [
    "#!/usr/bin/env zsh",
    "keychain_read ensemble-test-linear-key ensemble-test | curl -H @- u",
    'keychain_read "$s" "$a" | sed x',
    "security find-generic-password -s ensemble-test-github -w | y",
    "security delete-generic-password -a alice",
    "",
  ].join("\n"),
  "runbooks/setup.md": [
    "# Setup",
    "",
    "Then `keychain_read ensemble-test-github | ~/apm/bin/secfield s '#pw'`.",
    "Store it: `~/apm/runbooks/setup-test-env/storekey <service> <account>`.",
    "",
  ].join("\n"),
  "tests/x.test.ts": 'const s = "keychain_read nowhere-listed";\n',
};

const at = (where: string, name: string) =>
  `${where}: keychain item ${name} is not in status.md's Current environment table`;

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  at("mini/runbooks/setup/lq:2", "ensemble-test-linear-key / other"),
  at("mini/runbooks/setup/lq:3", "ensemble-old / x"),
  at("mini/runbooks/setup/lq:4", "ensemble-new / alice"),
  at("runbooks/setup.md:3", "strata-api-key / strata"),
  at("runbooks/setup.md:4", "ensemble-test-x / a@b.c"),
];
