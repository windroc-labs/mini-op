const item = "mac-mini-" + "alice-password";
const other = "mac-mini-" + "x.y_z-password";

export const violation = {
  "README.md": `# x\n\nThe password: \`${item}\`.\n`,
  "ctl/mini": `#!/bin/zsh\nsecurity find-generic-password -s ${other} -w | ssh mini x\n`,
};

export const clean = {
  "README.md":
    "The mini's password: mini-op's secrets dir, typed in by the user; not mac-mini-password.\n",
  "ctl/mini": '#!/bin/zsh\nssh mini x < "$pwfile"\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "README.md:3: names a MacBook keychain item for the mini's password; the user types the password in",
  "ctl/mini:2: names a MacBook keychain item for the mini's password; the user types the password in",
];
