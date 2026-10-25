const secrets = "/run/" + "secrets";

export const violation = {
  "mini/bin/a": `#!/bin/zsh\ncat /opt/mini-op/README.md\n# reads ${secrets}/alice\ndocker ps\n`,
  "mini/bin/b": "#!/bin/zsh\n. ../ctl/lib/x.zsh; cat host/ssh_config\n",
  "ctl/mini-x": "#!/bin/zsh\nosascript -e 1\nfront=$(osascript -e 2)\n",
  "host/y":
    '#!/usr/bin/env bash\nk="$(security find-generic-password -w)"\ncat <<< x\ny="`osascript -e 1`"\n',
  "README.md": "Copy: `scp -r scripts/* ctl mini:apm/`\n",
  "runbooks/x.md": "`scp -F host/ssh_config host/start alice@mini:apm/`\n",
};

export const clean = {
  "mini/bin/a": "#!/bin/zsh\nopen https://localhost/x; echo dockerish ctlx/ ghost/\n",
  "ctl/mini-x": [
    "#!/bin/zsh",
    "# osascript runs on the mini",
    "ssh mini 'osascript -e 1'",
    'ssh mini "security find-generic-password -w" < x',
    "cat <<'AS' | ssh mini 'osascript -'",
    "osascript",
    "AS",
    "",
  ].join("\n"),
  "host/start": "#!/usr/bin/env bash\ndocker run --security-opt no-new-privileges x\n",
  "README.md":
    "`scp -r mini/* mini:apm/`, `scp -F host/ssh_config -r mini/* mini:apm/`, `scp mini:/tmp/s.png .`\n",
  "ctl/CLAUDE.md": "`scp -r /opt/mini-op/mini/* mini:apm/`\n",
  "tests/x.test.ts": "scp ctl/x mini:apm/\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "mini/bin/a:2: mini/ names /opt/mini-op",
  "mini/bin/a:3: mini/ names the container's secrets dir",
  "mini/bin/a:4: mini/ names docker",
  "mini/bin/b:2: mini/ names ctl/",
  "mini/bin/b:2: mini/ names host/",
  "ctl/mini-x:2: runs osascript on this machine; the mini's tools run only over ssh",
  "ctl/mini-x:3: runs osascript on this machine; the mini's tools run only over ssh",
  "host/y:2: runs security on this machine; the mini's tools run only over ssh",
  "host/y:4: runs osascript on this machine; the mini's tools run only over ssh",
  "README.md:1: copies scripts/* to the mini; only mini/ goes there",
  "README.md:1: copies ctl to the mini; only mini/ goes there",
  "runbooks/x.md:1: copies host/start to the mini; only mini/ goes there",
];
