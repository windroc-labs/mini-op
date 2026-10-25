const sample = (name: string) =>
  `export const violation = { "${name}.sh": "x" };\nexport const clean = {};\nexport const expected = [];\n`;

export const violation = {
  "tests/guards/index.ts": 'import "./no_samples.ts";\nimport "./no_clean.ts";\n',
  "tests/guards/no_samples.ts": "export const guard = {};\n",
  "tests/guards/no_clean.ts": "export const guard = {};\n",
  "tests/guards/samples/no_clean.ts": "export const violation = {};\n",
  "tests/guards/unlisted.ts": "export const guard = {};\n",
  "tests/guards/samples/unlisted.ts": sample("unlisted"),
};

export const clean = {
  "tests/guards/index.ts": 'import "./listed.ts";\n',
  "tests/guards/listed.ts": "export const guard = {};\n",
  "tests/guards/samples/listed.ts": sample("listed"),
  "tests/guards/run.ts": "// the runner is not a guard\n",
  "tests/guards/run.test.ts": "// nor is a test\n",
};

// Every violation the sample must produce, as "<file>:<line>: <message>".
export const expected = [
  "tests/guards/samples/no_clean.ts:1: no clean sample",
  "tests/guards/samples/no_clean.ts:1: no expected sample",
  "tests/guards/no_samples.ts:1: no samples in tests/guards/samples/no_samples.ts",
  "tests/guards/unlisted.ts:1: not listed in tests/guards/index.ts",
];
