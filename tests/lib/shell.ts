// Shell text views for guards: comments, and optionally quoted strings and heredoc bodies, blanked
// to spaces, so a rule sees only the commands this shell runs itself, at their original lines and
// columns. `$(…)` and backtick substitutions inside double quotes are kept: they run here too.

const HEREDOC = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

// A quoted string's or heredoc's body, as shellCode found it.
export type Region = { start: number; end: number; kind: "'" | '"' | "heredoc" };

export function shellCode(
  text: string,
  opts: { strings: "blank" | "keep"; regions?: Region[] },
): string {
  const out = text.split("");
  const keep = opts.strings === "keep";
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  const pending: { delimiter: string; tabs: boolean }[] = [];
  // The end of a $( … ) starting at `open` (its "(" index), counting nested parentheses.
  const substitution = (open: number): number => {
    let depth = 0;
    for (let j = open; j < text.length; j++) {
      if (text[j] === "\\") j++;
      else if (text[j] === "(") depth++;
      else if (text[j] === ")" && --depth === 0) return j;
    }
    return text.length;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const prev = i === 0 ? "\n" : (text[i - 1] ?? "");
    if (c === "\\") {
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end;
      if (!keep) blank(i + 1, stop);
      opts.regions?.push({ start: i + 1, end: stop, kind: "'" });
      i = stop + 1;
    } else if (c === '"') {
      let j = i + 1;
      let from = j;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          j += 2;
        } else if (text[j] === "$" && text[j + 1] === "(") {
          if (!keep) blank(from, j);
          j = substitution(j + 1) + 1;
          from = j;
        } else if (text[j] === "`") {
          if (!keep) blank(from, j);
          const end = text.indexOf("`", j + 1);
          j = end < 0 ? text.length : end + 1;
          from = j;
        } else {
          j++;
        }
      }
      if (!keep) blank(from, j);
      opts.regions?.push({ start: i + 1, end: Math.min(j, text.length), kind: '"' });
      i = j + 1;
    } else if (c === "#" && /[\s;&|()]/.test(prev)) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (text.startsWith("<<<", i)) {
      i += 3;
    } else if (c === "<" && text[i + 1] === "<") {
      const match = HEREDOC.exec(text.slice(i));
      if (match) {
        pending.push({ delimiter: match[2] ?? "", tabs: match[0].startsWith("<<-") });
        i += match[0].length;
      } else {
        i += 2;
      }
    } else if (c === "\n" && pending.length > 0) {
      // Heredoc bodies start on the next line, one after another; each ends at its delimiter line.
      let j = i + 1;
      for (const doc of pending) {
        const start = j;
        let body = text.length;
        while (j < text.length) {
          const end = text.indexOf("\n", j);
          const stop = end < 0 ? text.length : end;
          const line = text.slice(j, stop);
          if ((doc.tabs ? line.replace(/^\t+/, "") : line) === doc.delimiter) body = j;
          j = stop + 1;
          if (body < text.length) break;
        }
        if (!keep) blank(start, body);
        opts.regions?.push({ start, end: Math.min(body, text.length), kind: "heredoc" });
      }
      pending.length = 0;
      i = j;
    } else {
      i++;
    }
  }
  return out.join("");
}

// Command position (FR-31, FR-35, FR-37): start of text or line, after ; & | { ` or a ( not after =,
// or after a word that runs the next one, then any NAME=value assignments.
const PREFIX_WORDS =
  "then|do|else|elif|if|while|until|exec|command|builtin|nohup|time|xargs|env|sudo|!";
export const COMMAND_START =
  `(?:^|[;&|{\`]|(?<!=)\\(|(?<![\\w./~-])(?:${PREFIX_WORDS})(?=[ \\t]))` +
  "[ \\t]*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*[ \\t]+)*";
const PREFIXES = new Set(PREFIX_WORDS.split("|"));
// Options of prefix words that take the next word as their argument.
const PREFIX_ARGS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-C", "-h", "-p"],
  env: ["-u", "-C"],
  xargs: ["-I", "-n", "-L", "-P", "-s", "-E", "-d"],
};
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const REDIRECT = /^(?:[0-9]*(?:<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)|&>>?)/;

// One view of shell text: `text` as written there, `code` its shellCode (comments and nested
// strings blank), `at` the offset in the file of a view offset. `expands`: the text came from a
// double-quoted string or heredoc, so the outer shell expands $ in it, single quotes or not.
export type ShellView = { text: string; code: string; at(index: number): number; expands: boolean };

// `index`: where the target starts in its view.
export type Redirect = { op: string; target: string; index: number };

export type Command = {
  // A block's opener ({ while until: markers; for select are commands too), its closer (} done,
  // and ")" for a subshell), or a plain command.
  kind: "command" | "open" | "close";
  name: string;
  words: string[];
  redirects: Redirect[];
  assignments: string[];
  index: number;
  end: number;
  // The construct the command runs in: $( <( >( ( ` or null at the top or in a { } group.
  opener: string | null;
  // What ends it: ; \n & && | || |& ) or "" at the end of the text.
  terminator: string;
  prev?: Command;
  // A closer's block: the opener's offset to the closer's.
  group?: { from: number; to: number };
};

// A string body as shell sees it: escapes in double quotes undone, with each char's offset.
function unescape(text: string, region: Region): { body: string; map: number[] } {
  let body = "";
  const map: number[] = [];
  for (let i = region.start; i < region.end; i++) {
    if (region.kind === '"' && text[i] === "\\" && i + 1 < region.end) {
      const next = text[i + 1] ?? "";
      if (next === "\n") {
        i++;
        continue;
      }
      if ('"$`\\'.includes(next)) i++;
    }
    body += text[i];
    map.push(i);
  }
  return { body, map };
}

// The file's code, then every quoted string and heredoc body scanned as shell in turn (to depth
// 4): strings passed to `ssh mini`, heredocs fed to a shell.
export function shellViews(
  text: string,
  at = (i: number) => i,
  depth = 0,
  expands = false,
): ShellView[] {
  const regions: Region[] = [];
  const code = shellCode(text, { strings: "blank", regions });
  const views: ShellView[] = [{ text, code, at, expands }];
  if (depth >= 4) return views;
  for (const region of regions) {
    const { body, map } = unescape(text, region);
    if (!body.trim()) continue;
    const childAt = (i: number) => at(map[i] ?? region.start);
    views.push(...shellViews(body, childAt, depth + 1, expands || region.kind !== "'"));
  }
  return views;
}

// The end of a balanced construct starting at `open` (its opening char) in code: ( ) or { }.
function balanced(code: string, open: number, to: number): number {
  const close = code[open] === "{" ? "}" : ")";
  const first = code[open];
  let depth = 0;
  for (let i = open; i < to; i++) {
    const c = code[i];
    if (c === "\\") i++;
    else if (c === "'" || c === '"') i = quoted(code, i, to) - 1;
    else if (c === "`") i = backtick(code, i, to) - 1;
    else if (c === first) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return to;
}

function backtick(code: string, open: number, to: number): number {
  for (let i = open + 1; i < to; i++) {
    if (code[i] === "\\") i++;
    else if (code[i] === "`") return i + 1;
  }
  return to;
}

// The end of a quoted string starting at `open`; double quotes may hold $( ) and backticks.
function quoted(code: string, open: number, to: number): number {
  const q = code[open];
  for (let i = open + 1; i < to; i++) {
    const c = code[i];
    if (q === '"' && c === "\\") i++;
    else if (c === q) return i + 1;
    else if (q === '"' && c === "$" && code[i + 1] === "(") i = balanced(code, i + 1, to) - 1;
    else if (q === '"' && c === "`") i = backtick(code, i, to) - 1;
  }
  return to;
}

type Sub = { from: number; to: number; opener: string };

// One word from `i`: its end and the substitutions inside it.
function word(code: string, i: number, to: number): { end: number; subs: Sub[] } {
  const subs: Sub[] = [];
  const start = i;
  while (i < to) {
    const c = code[i] ?? "";
    const next = code[i + 1] ?? "";
    if (/\s/.test(c) || ";&|)".includes(c)) break;
    if (c === "\\") {
      i += 2;
    } else if (c === "'") {
      i = quoted(code, i, to);
    } else if (c === '"') {
      const end = quoted(code, i, to);
      for (let j = i + 1; j < end - 1; j++) {
        if (code[j] === "\\") j++;
        else if (code[j] === "$" && code[j + 1] === "(") {
          const close = balanced(code, j + 1, end);
          subs.push({ from: j + 2, to: close - 1, opener: "$(" });
          j = close - 1;
        } else if (code[j] === "`") {
          const close = backtick(code, j, end);
          subs.push({ from: j + 1, to: close - 1, opener: "`" });
          j = close - 1;
        }
      }
      i = end;
    } else if (c === "$" && next === "(") {
      const close = balanced(code, i + 1, to);
      subs.push({ from: i + 2, to: close - 1, opener: "$(" });
      i = close;
    } else if (c === "$" && next === "{") {
      i = balanced(code, i + 1, to);
    } else if (c === "`") {
      const close = backtick(code, i, to);
      subs.push({ from: i + 1, to: close - 1, opener: "`" });
      i = close;
    } else if ((c === "<" || c === ">") && next === "(" && i === start) {
      const close = balanced(code, i + 1, to);
      subs.push({ from: i + 2, to: close - 1, opener: c + "(" });
      i = close;
    } else if (c === "(") {
      if (i === start) break;
      i = balanced(code, i, to);
    } else if (c === "<" && i > start && /^<[0-9]*-?[0-9]*>/.test(code.slice(i, i + 24))) {
      i += (/^<[0-9]*-?[0-9]*>/.exec(code.slice(i, i + 24))?.[0] ?? "<").length;
    } else if (c === "<" || c === ">") {
      break;
    } else {
      i++;
    }
  }
  return { end: i, subs };
}

// The commands of a view, in text order, nested ones (substitutions, subshells) included.
export function commands(view: ShellView): Command[] {
  const found: Command[] = [];
  parse(view, 0, view.code.length, null, found);
  return found.sort((a, b) => a.index - b.index);
}

function marker(
  kind: Command["kind"],
  name: string,
  index: number,
  end: number,
  opener: string | null,
): Command {
  return {
    kind,
    name,
    words: [],
    redirects: [],
    assignments: [],
    index,
    end,
    opener,
    terminator: "",
  };
}

const OPENS = new Set(["for", "select"]);
const CLOSES = new Set(["}", "done"]);

function parse(view: ShellView, from: number, to: number, opener: string | null, out: Command[]) {
  const { code, text } = view;
  let i = from;
  let current: Command | undefined;
  let prev: Command | undefined;
  let start = true;
  let prefix = "";
  let skipArg = false;
  let assignments: string[] = [];
  let pending: Redirect[] = [];
  const blocks: number[] = [];
  const finish = (terminator: string) => {
    if (current) {
      current.terminator = terminator;
      prev = current;
    }
    current = undefined;
    start = true;
    prefix = "";
    assignments = [];
  };
  const nested = (subs: Sub[]) => {
    for (const sub of subs) parse(view, sub.from, sub.to, sub.opener, out);
  };
  while (i < to) {
    const c = code[i] ?? "";
    const two = code.slice(i, i + 2);
    if (c === " " || c === "\t") {
      i++;
    } else if (two === "\\\n") {
      i += 2;
    } else if (c === "\n" || c === ";") {
      finish(c);
      i += code.slice(i, i + 2) === ";;" || two === ";&" || two === ";|" ? 2 : 1;
    } else if (two === "&&" || two === "||" || two === "|&") {
      finish(two);
      i += 2;
    } else if ((c === "|" || c === "&") && !REDIRECT.test(code.slice(i, i + 3))) {
      finish(c);
      i++;
    } else if (c === ")") {
      finish(c);
      i++;
    } else if (c === "(" && start) {
      const close = balanced(code, i, to);
      parse(view, i + 1, close - 1, "(", out);
      current = {
        ...marker("close", ")", close - 1, close, opener),
        group: { from: i, to: close - 1 },
        ...(prev && { prev }),
      };
      out.push(current);
      i = close;
      start = false;
    } else if (REDIRECT.test(code.slice(i, i + 4)) && !/^[<>]\(/.test(code.slice(i, i + 2))) {
      const op = REDIRECT.exec(code.slice(i, i + 4))?.[0] ?? "";
      i += op.length;
      while (code[i] === " " || code[i] === "\t") i++;
      const w = word(code, i, to);
      const redirect = { op, target: text.slice(i, w.end), index: i };
      if (current) current.redirects.push(redirect);
      else pending.push(redirect);
      nested(w.subs);
      i = Math.max(w.end, i + 1);
    } else {
      const w = word(code, i, to);
      if (w.end === i) {
        i++;
        continue;
      }
      const value = text.slice(i, w.end);
      nested(w.subs);
      const body = !start && value === "{" && /\(\)$|^function$/.test(current?.name ?? "");
      if (body) finish("");
      if (!start) {
        current?.words.push(value);
      } else if (value === "{") {
        // a group or function body: a marker the matching } closes; its commands start here
        out.push({ ...marker("open", value, i, w.end, opener), ...(prev && { prev }) });
        blocks.push(i);
      } else if (skipArg) {
        skipArg = false;
      } else if (prefix && value.startsWith("-") && value !== "-") {
        skipArg = (PREFIX_ARGS[prefix] ?? []).includes(value);
      } else if (ASSIGNMENT.test(value)) {
        assignments.push(value);
      } else if (PREFIXES.has(value)) {
        // while/until open a loop its done closes: a marker, as for {
        if (value === "while" || value === "until") {
          out.push(marker("open", value, i, w.end, opener));
          blocks.push(i);
        }
        prefix = value;
      } else {
        const from = CLOSES.has(value) ? blocks.pop() : undefined;
        if (OPENS.has(value)) blocks.push(i);
        current = {
          kind: CLOSES.has(value) ? "close" : "command",
          name: value,
          words: [],
          redirects: pending,
          assignments,
          index: i,
          end: w.end,
          opener,
          terminator: "",
          ...(prev && { prev }),
          ...(from !== undefined && { group: { from, to: i } }),
        };
        out.push(current);
        pending = [];
        start = false;
      }
      if (current && !start) current.end = w.end;
      i = w.end;
    }
  }
  finish("");
}
