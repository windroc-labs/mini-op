// The subcommand built from parts, so this file never names it.
const find = "find-" + "generic-password";

export const violation = {
  "mini/runbooks/setup/lq": `#!/usr/bin/env zsh\nsecurity ${find} -s k -a a -w | curl -H @- u\n`,
  "ctl/x": `#!/usr/bin/env zsh\nssh mini 'security ${find} -s k -w | ~/apm/bin/ans 9'\n`,
  "runbooks/setup.md": `# Setup\n\nThen \`security ${find} -s strata-api-key -w | ~/apm/bin/ans 120\`.\n`,
};

export const clean = {
  "mini/lib/keychain.zsh": `keychain_read() { security ${find} -s "$1" -w; }\n`,
  "mini/runbooks/setup/lq": "#!/usr/bin/env zsh\nkeychain_read k a | curl -H @- u\n",
  "runbooks/setup.md":
    "# Setup\n\nThen `keychain_read strata-api-key strata | ~/apm/bin/ans 120`.\n",
  "tests/mini/lib/keychain.test.ts": `const argv = ["${find}", "-s", "svc"];\n`,
};

const message =
  "reads the keychain itself; use keychain_read or keychain_has (mini/lib/keychain.zsh)";

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `mini/runbooks/setup/lq:2: ${message}`,
  `ctl/x:2: ${message}`,
  `runbooks/setup.md:3: ${message}`,
];
