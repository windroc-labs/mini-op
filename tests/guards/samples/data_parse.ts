export const violation = {
  "mini/bin/a": [
    "#!/usr/bin/env zsh",
    `data(){ sed -E 's/.*"data":"?([^"}]*)"?}.*/\\1/'; }`,
    `v=$(o eval x | sed -E 's/.*\\"data\\": *"([^"]*)".*/\\1/')`,
    "",
  ].join("\n"),
  "mini/runbooks/setup/b": "#!/usr/bin/env zsh\ngrep -o '\"data\" : [^,]*' r\n",
  "ctl/c": "#!/usr/bin/env zsh\nawk -F'\"data\":' '{print $2}'\n",
};

export const clean = {
  "mini/lib/opencli.zsh": `opencli_data() { rest=\${reply#*'"data":'}; }\n`,
  "mini/bin/a": "#!/usr/bin/env zsh\nv=$(o eval x | opencli_data)\n",
  "tests/mini/bin/a.test.ts": `const reply = '{"ok":true,"data":12}';\n`,
  "README.md": 'Replies are `{"ok":true,"data":…}`.\n',
};

const message = "parses OpenCLI's data itself; pipe the reply to opencli_data (mini/lib)";

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `mini/bin/a:2: ${message}`,
  `mini/bin/a:3: ${message}`,
  `mini/runbooks/setup/b:2: ${message}`,
  `ctl/c:2: ${message}`,
];
