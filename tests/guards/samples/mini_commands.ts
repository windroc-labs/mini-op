export const violation = {
  "mini/bin/a": "#!/bin/zsh\npython3 -c 1\nx=$(node -e 1); brew install jq\n",
  "mini/runbooks/r/b": "#!/bin/zsh\nssh x 'pip3 install y'; /opt/homebrew/bin/tmux ls\n",
  "mini/js/c.js": "// fine\nfunction run() { doShellScript('npx thing'); }\n",
};

export const clean = {
  "mini/bin/a": [
    "#!/bin/zsh",
    "# never python3 here: a blank mini has none",
    "export PATH=/usr/local/bin:$HOME/.npm-global/bin:$PATH",
    "x=$(opencli browser state) # not node",
    "",
  ].join("\n"),
  "mini/js/c.js": "// node would do\nfunction run() { return e.parentNode; } // https://x\n",
  "ctl/mini-x": "#!/bin/zsh\nnode -e 1\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: calls python3; the mini runs only macOS's own commands and opencli",
  "mini/bin/a:3: calls node; the mini runs only macOS's own commands and opencli",
  "mini/bin/a:3: calls brew; the mini runs only macOS's own commands and opencli",
  "mini/runbooks/r/b:2: calls pip3; the mini runs only macOS's own commands and opencli",
  "mini/runbooks/r/b:2: calls /opt/homebrew; the mini runs only macOS's own commands and opencli",
  "mini/js/c.js:2: calls npx; the mini runs only macOS's own commands and opencli",
];
