const script = "#!/bin/zsh\ntrue\n";

export const violation = {
  "mini/bin/ans": script,
  "mini/bin/lonely": "#!/bin/zsh\n# lonely: no one calls me\n",
  "mini/runbooks/setup/lq": script,
  "ctl/mini-x": script,
  "host/start": script,
  "host/stop": script,
  "README.md": "Run `~/apm/bin/ans` and `mini/bin/answers`; `lq`; `mini-xy`; start, then stop.\n",
  "tests/x.test.ts": "ctl/mini-x host/start\n",
};

export const clean = {
  "mini/bin/ans": script,
  "mini/runbooks/setup/lq": script,
  "ctl/mini-x": script,
  "host/start": '#!/usr/bin/env bash\n"$here/update"\n',
  "host/update": script,
  "host/Dockerfile": "FROM x\n",
  "README.md":
    "Run `ssh mini '~/apm/bin/ans 60'`, `mini/runbooks/setup/lq`, `mini-x` and `host/start`.\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/lonely:1: no doc or other script names bin/lonely",
  "mini/runbooks/setup/lq:1: no doc or other script names runbooks/setup/lq",
  "ctl/mini-x:1: no doc or other script names mini-x",
  "host/start:1: no doc or other script names /start",
  "host/stop:1: no doc or other script names /stop",
];
