const files = {
  "tsconfig.json": "{}\n",
  "package.json": "{}\n",
  "tests/lib/sandbox.ts": "export {};\n",
  "tests/guards/x.ts": "export {};\n",
  ".github/workflows/ci.yml": "on: push\n",
  "mini/bin/ans": "#!/bin/zsh\n",
};

export const violation = {
  ...files,
  ".github/CODEOWNERS":
    "/.github/ @windroc\n/package.json @someone-else\n/tests/ @windroc\n/tests/lib/\n",
};

export const clean = {
  ...files,
  ".github/CODEOWNERS": [
    "# Changes here need the user's review.",
    "/.github/ @windroc",
    "/tests/guards/ @windroc",
    "/tests/lib/ @windroc",
    "/tsconfig.json @windroc",
    "/package.json @windroc",
    "",
  ].join("\n"),
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "package.json:1: no .github/CODEOWNERS rule makes @windroc its owner",
  "tests/lib/sandbox.ts:1: no .github/CODEOWNERS rule makes @windroc its owner",
  "tsconfig.json:1: no .github/CODEOWNERS rule makes @windroc its owner",
];
