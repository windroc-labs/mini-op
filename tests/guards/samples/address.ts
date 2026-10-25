// The local file never reaches a sample view (guards/run.ts adds it): samples check the base only.
export const violation = {
  "host/config.yaml": "# the mini\nmini_host: 10.9.8.7\nmini_user: alice  # login\nmini_port: 22\n",
};

export const clean = {
  "host/config.yaml": '# the mini\nmini_host: ""\nmini_user: ""  # set locally\nmini_port: 22\n',
  "README.md": "ssh mini x\n",
};

const set = "set it in ~/.mini-op/config.local.yaml";

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  `host/config.yaml:2: mini_host must be "" here; ${set}`,
  `host/config.yaml:3: mini_user must be "" here; ${set}`,
];
