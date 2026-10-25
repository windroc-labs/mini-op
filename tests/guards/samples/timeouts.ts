// The word built from parts, so this file never names it.
const word = "al" + "arm";
const Word = "Al" + "arm";

export const violation = {
  "ctl/x": `#!/usr/bin/env zsh\nssh mini "perl -e '${word} 8; exec @ARGV' osascript x"\n`,
  "README.md": `# x\n\nWrap it in \`perl -e '${word} 8; exec @ARGV'\`.\nsh prints "${Word} clock".\n`,
  "tests/ctl/x.test.ts": `// ${word}: kill the step\n`,
  "tests/mini/lib/x.test.ts": `run(["perl", "-e", "${word} 1; exec @ARGV"]);\n`,
};

export const clean = {
  "mini/lib/x.zsh": `with_timeout() { perl -e '${word} shift; exec { $ARGV[0] } @ARGV' "$@"; }\n`,
  "ctl/mini": "#!/usr/bin/env zsh\nwith_timeout 10 osascript x # SIGALRM: 124\n",
  "README.md": "Wrap it in `with_timeout 8` (`mini/lib/timeout.zsh`, 124).\n",
};

const message = `names ${word}; time out with with_timeout or poll (mini/lib/timeout.zsh, exit 124)`;

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `ctl/x:2: ${message}`,
  `README.md:3: ${message}`,
  `README.md:4: ${message}`,
  `tests/ctl/x.test.ts:1: ${message}`,
  `tests/mini/lib/x.test.ts:1: ${message}`,
];
