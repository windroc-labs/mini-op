const registry = (rows: object[]) => JSON.stringify(rows);

export const violation = {
  "tests/registry/path-bypass.json": registry([
    { file: "mini/bin/o", reason: "" },
    { file: "mini/bin/fixed", reason: "no longer bypasses PATH" },
    { file: "mini/bin/new", reason: "not in the E1 baseline" },
  ]),
  "mini/bin/o": "#!/bin/zsh\nexport PATH=/usr/local/bin:$PATH\n",
  "mini/bin/fixed": "#!/bin/zsh\nopencli list\n",
  "mini/bin/new": "#!/bin/zsh\nPATH=/x:$PATH ssh mini\n",
  "mini/bin/abs": "#!/bin/zsh\n/usr/bin/security find-generic-password -w\n",
  "mini/bin/cmdp": "#!/bin/zsh\ncommand -p ssh mini true\n",
  "mini/bin/zpath": "#!/bin/zsh\npath+=/opt/homebrew/bin\n",
  "mini/bin/zpath2": "#!/bin/zsh\npath=(/usr/bin $path)\n",
  "mini/bin/envi": "#!/bin/zsh\nenv -i ssh mini true\n",
  "host/envu": "#!/usr/bin/env bash\nenv -u PATH docker ps\n",
};

export const clean = {
  "tests/registry/path-bypass.json": registry([
    { file: "mini/bin/o", reason: "appends opencli's install dirs to PATH" },
  ]),
  "mini/bin/o": "#!/bin/zsh\nexport PATH=$PATH:/usr/local/bin\n",
  "host/Dockerfile":
    "ENV PATH=/opt/windroc/plugins/mini-op/ctl:$PATH\nCOPY ssh_config /etc/ssh/ssh_config.d/\n",
  "ctl/ok": "#!/bin/zsh\n# never /usr/bin/ssh here\nssh -F ~/.ssh/config mini true\n",
  "mini/bin/env": "#!/bin/zsh\nenv LANG=C sort\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/registry/path-bypass.json:1: mini/bin/o has no reason",
  "tests/registry/path-bypass.json:1: mini/bin/fixed is not in E1's baseline; call tools by name",
  "tests/registry/path-bypass.json:1: mini/bin/fixed no longer bypasses PATH; remove its row",
  "tests/registry/path-bypass.json:1: mini/bin/new is not in E1's baseline; call tools by name",
  "host/envu:2: clears PATH with env",
  "mini/bin/abs:2: runs a sandboxed command by absolute path",
  "mini/bin/cmdp:2: uses command -p",
  "mini/bin/envi:2: clears PATH with env",
  "mini/bin/zpath:2: assigns PATH",
  "mini/bin/zpath2:2: assigns PATH",
];
