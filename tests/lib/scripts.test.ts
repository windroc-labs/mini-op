import assert from "node:assert/strict";
import { test } from "node:test";
import { lineAt } from "./guard.ts";
import { fromFiles } from "./repo.ts";
import { docShellViews, shellSources } from "./scripts.ts";
import { commands } from "./shell.ts";

const files = {
  "mini/bin/a": "#!/usr/bin/env zsh\nls x\n",
  "mini/lib/b.zsh": "f() { cat y; }\n",
  "README.md": "ls\n",
  "host/Dockerfile": "FROM x\nRUN set -eux; \\\n    apt-get update; \\\n    touch z\nENV A=1\n",
  ".github/workflows/ci.yml": [
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: echo one",
    "      - name: two",
    "        run: |",
    "          make",
    "",
    "          echo two",
  ].join("\n"),
  "tests/guards/samples/x.ts": "",
};

test("shellSources: shell files, Dockerfile RUN bodies and workflow run lines, at file lines", () => {
  const view = fromFiles(files);
  const found = shellSources(view).flatMap((source) =>
    source.views.flatMap((v) =>
      commands(v).map(
        (c) => `${source.file}:${lineAt(view.read(source.file), v.at(c.index))} ${c.name}`,
      ),
    ),
  );
  assert.deepEqual(found, [
    ".github/workflows/ci.yml:4 echo",
    ".github/workflows/ci.yml:7 make",
    ".github/workflows/ci.yml:9 echo",
    "host/Dockerfile:2 set",
    "host/Dockerfile:3 apt-get",
    "host/Dockerfile:4 touch",
    "mini/bin/a:2 ls",
    "mini/lib/b.zsh:1 f()",
    "mini/lib/b.zsh:1 {",
    "mini/lib/b.zsh:1 cat",
    "mini/lib/b.zsh:1 }",
  ]);
});

test("docShellViews: one view per fenced block, one per inline span", () => {
  const text = [
    "Run `ls a` first.",
    "",
    "```sh",
    "pbpaste | while read l; do",
    "  mini run",
    "done",
    "```",
    "then `b`",
  ].join("\n");
  const views = docShellViews(text);
  assert.deepEqual(
    views.map((v) => v.text),
    ["ls a", "pbpaste | while read l; do\n  mini run\ndone", "b"],
  );
  const [, block] = views;
  assert.ok(block);
  assert.deepEqual(
    commands(block).map((c) => `${lineAt(text, block.at(c.index))} ${c.name}`),
    ["4 pbpaste", "4 while", "4 read", "5 mini", "6 done"],
  );
});
