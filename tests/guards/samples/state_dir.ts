export const violation = {
  "mini/bin/a": "#!/bin/zsh\nout=${1:-/tmp/s.png}\n# was /tmp/x\n",
  "mini/bin/b": "#!/bin/zsh\nS=/tmp/mark.$1; cat $TMPDIR/x /tmp\n",
  "mini/bin/c": "#!/bin/zsh\ncp x /private/tmp/x /var/tmp/y\n",
};

export const clean = {
  "mini/bin/a": "#!/bin/zsh\nout=${1:-$HOME/apm/state/shot.png}\necho /tmpl ~/tmp/x $HOME/tmp\n",
  "ctl/mini-x": "#!/bin/zsh\nssh mini 'cat /tmp/x'\n",
  "README.md": "Run `<cmd> > /tmp/x 2>&1` on the mini.\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: mini/ names /tmp; runtime state goes in ~/apm/state/",
  "mini/bin/a:3: mini/ names /tmp; runtime state goes in ~/apm/state/",
  "mini/bin/b:2: mini/ names /tmp; runtime state goes in ~/apm/state/",
  "mini/bin/b:2: mini/ names /tmp; runtime state goes in ~/apm/state/",
  "mini/bin/c:2: mini/ names /tmp; runtime state goes in ~/apm/state/",
  "mini/bin/c:2: mini/ names /tmp; runtime state goes in ~/apm/state/",
];
