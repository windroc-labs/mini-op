// The five wrappers ctl/mini replaced, built from parts so this file never names them.
const [ans, pw, sa, sudo, chord] = ["ans", "pw", "sa", "sudo", "chord"].map((s) => "mini-" + s);

export const violation = {
  "README.md": `# x\n\nRun \`ctl/${ans} 'ls'\`.\nThe dialog: ${sa}.\n`,
  "ctl/x": `#!/bin/zsh\nexec \${0:A:h}/${pw} "$@"\n`,
  "runbooks/a.md": `\`${sudo} -v\`, then \`${chord} command 40\`.\n`,
  [`tests/ctl/${chord}.test.ts`]: 'import { test } from "node:test";\n',
};

export const clean = {
  "README.md":
    "Type it with `mini pw`, `mini pw --sa`, `mini run`, `mini sudo -v`, `mini chord command 40`.\n" +
    "The mini-op container; mini-ansible, xmini-pw, mini-pwd, mini-sa_1.\n",
  "ctl/mini": '#!/usr/bin/env zsh\ncase $1 in\n  pw) pw_mini "$@" ;;\nesac\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `README.md:3: \`${ans}\` is retired: use \`mini run\``,
  `README.md:4: \`${sa}\` is retired: use \`mini pw --sa\``,
  `ctl/x:2: \`${pw}\` is retired: use \`mini pw\``,
  `runbooks/a.md:1: \`${sudo}\` is retired: use \`mini sudo\``,
  `runbooks/a.md:1: \`${chord}\` is retired: use \`mini chord\``,
  `tests/ctl/${chord}.test.ts:1: \`${chord}\` is retired: use \`mini chord\``,
];
