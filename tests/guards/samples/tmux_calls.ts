const kill = "kill-" + "server";

export const violation = {
  "ctl/a": `#!/bin/zsh\nssh mini 'tmux ${kill}'\ntmux -S /tmp/s new -d\ntmux -L x ${kill.slice(0, 8)}\ntmux -uS /tmp/s ls\ntmux -uL x -S /tmp/s ls\ntmux -f/tmp/t.conf -S /tmp/s ls\ntmux -Lc -S /tmp/s ls\n`,
  "mini/bin/b": `#!/bin/zsh\nssh mini <<EOF\ntmux -S/tmp/x ls\nEOF\n`,
  "tests/c.test.ts": `run(["tmux", "${kill}"]);\nrun(["tmux", "-S", sock, "ls"]);\nrun(["tmux", "-L", name, "-S", sock, "ls"]);\n`,
};

export const clean = {
  "ctl/a":
    "#!/bin/zsh\ntmux capture-pane -p -t apmtest:0.0\ntmux kill-session -t b1\ntmux -LS ls\ntmux -- -S x\ntmux capture-pane -p -S -50 -t x\ntmux send-keys -t '=mini:' x Enter\n",
  "README.md": `Never \`tmux ${kill}\`.\n`,
  "tests/c.test.ts": 'const FORBIDDEN = ["tmux", "ssh"];\nrun(["tmux", "ls"]);\n',
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `ctl/a:2: tmux ${kill}`,
  "ctl/a:3: tmux with -S",
  `ctl/a:4: tmux ${kill}`,
  "ctl/a:5: tmux with -S",
  "ctl/a:6: tmux with -S",
  "ctl/a:7: tmux with -S",
  "ctl/a:8: tmux with -S",
  "mini/bin/b:3: tmux with -S",
  `tests/c.test.ts:1: tmux ${kill}`,
  "tests/c.test.ts:2: tmux with -S",
  "tests/c.test.ts:3: tmux with -S",
];
