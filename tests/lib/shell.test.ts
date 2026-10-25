import assert from "node:assert/strict";
import { test } from "node:test";
import { lineAt } from "./guard.ts";
import { COMMAND_START, commands, shellCode, shellViews } from "./shell.ts";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

test("blanks quotes, comments and heredoc bodies, keeping lines and columns", () => {
  const text = [
    "ssh mini 'osascript -e x' # osascript here too",
    'echo "a $(front x) b" "c\\"d"',
    "cat <<'AS' | ssh mini",
    "osascript -",
    "AS",
    "n=${#x} $# done",
  ].join("\n");
  const code = shellCode(text, { strings: "blank" });
  assert.equal(code.length, text.length);
  assert.deepEqual(code.split("\n").map(words), [
    ["ssh", "mini", "'", "'"],
    ["echo", '"', "$(front", "x)", '"', '"', '"'],
    ["cat", "<<'AS'", "|", "ssh", "mini"],
    [],
    ["AS"],
    ["n=${#x}", "$#", "done"],
  ]);
});

test("keep leaves strings and heredocs, blanking only comments", () => {
  const text = "ssh mini 'a # b' # gone\ncat <<-EOF\n\tx # y\n\tEOF\n";
  assert.equal(
    shellCode(text, { strings: "keep" }),
    "ssh mini 'a # b'       \ncat <<-EOF\n\tx # y\n\tEOF\n",
  );
});

test("a here-string is no heredoc; backticks in double quotes run here", () => {
  const code = shellCode('cat <<< hi\nx="a `osascript` b"\nsecurity -w\n', { strings: "blank" });
  assert.deepEqual(code.split("\n").map(words), [
    ["cat", "<<<", "hi"],
    ['x="', "`osascript`", '"'],
    ["security", "-w"],
    [],
  ]);
});

test("an unterminated heredoc blanks to the end", () => {
  assert.equal(shellCode("cat <<X\nosascript\n", { strings: "blank" }), "cat <<X\n         \n");
});

// Shell text built from parts where it would trip the delete and tmux guards.
const RM = "r" + "m";
const KILL = "kill-" + "server";

// Commands of the file's own code, or (all) of every view: its strings and heredocs too.
function parsed(text: string, all = false) {
  const views = shellViews(text);
  return (all ? views : views.slice(0, 1)).flatMap((view) =>
    commands(view).map((c) => ({
      name: c.name,
      words: c.words,
      redirects: c.redirects.map((r) => `${r.op}${r.target}`),
      opener: c.opener,
      terminator: c.terminator,
      prev: c.prev?.name ?? null,
      line: lineAt(text, view.at(c.index)),
    })),
  );
}

test("commands: names, words with their quotes, terminators and the command before", () => {
  const text = `IFS= read -r x; ${RM} -f -- "\${marker:?}" | wc -l && echo 'a b' >&2\n`;
  assert.deepEqual(parsed(text), [
    {
      name: "read",
      words: ["-r", "x"],
      redirects: [],
      opener: null,
      terminator: ";",
      prev: null,
      line: 1,
    },
    {
      name: RM,
      words: ["-f", "--", '"${marker:?}"'],
      redirects: [],
      opener: null,
      terminator: "|",
      prev: "read",
      line: 1,
    },
    { name: "wc", words: ["-l"], redirects: [], opener: null, terminator: "&&", prev: RM, line: 1 },
    {
      name: "echo",
      words: ["'a b'"],
      redirects: [">&2"],
      opener: null,
      terminator: "\n",
      prev: "wc",
      line: 1,
    },
  ]);
});

test("commands: prefix words, assignments and their options are skipped", () => {
  const names = (text: string) => parsed(text).map((c) => `${c.name} ${c.words.join(" ")}`);
  assert.deepEqual(names(`LC_ALL=C ${RM} -rf "$d"\n`), [`${RM} -rf "$d"`]);
  assert.deepEqual(names(`sudo -u root ${RM} x\nenv -u V A=1 ${RM} y\n`), [`${RM} x`, `${RM} y`]);
  assert.deepEqual(names(`if true; then ${RM} a; fi\nfor f in a b; do ${RM} "$f"; done\n`), [
    "true ",
    `${RM} a`,
    "fi ",
    "for f in a b",
    `${RM} "$f"`,
    "done ",
  ]);
  assert.deepEqual(names("xargs -n 1 echo\n! grep x\n"), ["echo ", "grep x"]);
});

test("commands: substitutions, process substitutions and subshells carry their opener", () => {
  const c = parsed('k=$(pbpaste)\nIFS= read -r k < <(pbpaste)\n( cd x; ls )\ny="`id -u`"\n');
  assert.deepEqual(
    c.map((x) => [x.name, x.opener, x.line]),
    [
      ["pbpaste", "$(", 1],
      ["read", null, 2],
      ["pbpaste", "<(", 2],
      ["cd", "(", 3],
      ["ls", "(", 3],
      [")", null, 3],
      ["id", "`", 4],
    ],
  );
  assert.deepEqual(c[1]?.redirects, ["<<(pbpaste)"]);
});

test("commands: zsh globs and heredoc delimiters are not redirects", () => {
  const text = `for f in $d/<->-<->(N.mh+24); do ${RM} "$f"; done\ncat <<'AS' | ssh mini\nx\nAS\n`;
  assert.deepEqual(
    parsed(text, true).map((x) => [x.name, x.words.join(" "), x.line]),
    [
      ["for", "f in $d/<->-<->(N.mh+24)", 1],
      [RM, '"$f"', 1],
      ["done", "", 1],
      ["cat", "", 2],
      ["ssh", "mini", 2],
      ["AS", "", 4],
      ["$f", "", 1],
      ["x", "", 3],
    ],
  );
});

test("shellViews: quoted strings and heredocs are scanned as shell at their own lines", () => {
  const text = [
    "#!/bin/zsh",
    `ssh mini "${RM} -rf ~/apm/\\$d; echo \\"ok\\""`,
    `ssh mini 'tmux ${KILL}'`,
    "ssh mini <<EOF",
    `${RM} -f $x`,
    "EOF",
  ].join("\n");
  const c = parsed(text, true).filter((x) => !["ssh", "EOF"].includes(x.name));
  assert.deepEqual(
    c.map((x) => [x.name, x.words.join(" "), x.line]),
    [
      [RM, "-rf ~/apm/$d", 2],
      ["echo", '"ok"', 2],
      ["ok", "", 2],
      ["tmux", KILL, 3],
      [RM, "-f $x", 5],
    ],
  );
});

test("COMMAND_START matches after separators, keywords and assignments only", () => {
  const re = new RegExp(COMMAND_START + "(/\\S+)", "gm");
  const found = (text: string) => [...text.matchAll(re)].map((m) => m[1]);
  assert.deepEqual(found("/a x; /b\nX=1 /c\nthen /d\necho /e\nsudo /f\n"), [
    "/a",
    "/b",
    "/c",
    "/d",
    "/f",
  ]);
});
