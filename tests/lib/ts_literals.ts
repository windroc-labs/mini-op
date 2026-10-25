// TS string literals as the guards read them: each body unescaped, with the file offset of each
// char, and the argv-style arrays (["rm", …]) built from them. Comments and regexes are skipped.

export type TsString = {
  body: string;
  // The literal's span in the file, quotes included.
  start: number;
  end: number;
  // Whether it is a template holding ${…}.
  interpolated: boolean;
  at(index: number): number;
};

export type ArgvElement = { literal: string } | { expr: string };
export type ArgvArray = { index: number; elements: ArgvElement[] };

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0", b: "\b", f: "\f" };
// After these, a / starts a regex rather than a division.
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|void|yield))\s*$/;

type Scan = { strings: TsString[]; masked: string[] };

function literal(text: string, open: number, scan: Scan): number {
  const quote = text[open];
  const entry: TsString = { body: "", start: open, end: open, interpolated: false, at: () => open };
  scan.strings.push(entry);
  const map: number[] = [];
  let i = open + 1;
  while (i < text.length && text[i] !== quote) {
    const c = text[i] ?? "";
    if (c === "\\") {
      const next = text[i + 1] ?? "";
      if (next !== "\n") {
        entry.body += ESCAPES[next] ?? next;
        map.push(i);
      }
      i += 2;
    } else if (quote === "`" && c === "$" && text[i + 1] === "{") {
      entry.interpolated = true;
      const end = code(text, i + 2, scan, true);
      entry.body += text.slice(i, end);
      for (let k = i; k < end; k++) map.push(k);
      i = end;
    } else if (quote !== "`" && c === "\n") {
      break;
    } else {
      entry.body += c;
      map.push(i);
      i++;
    }
  }
  for (let k = open + 1; k < i; k++) scan.masked[k] = text[k] === "\n" ? "\n" : " ";
  entry.end = Math.min(i + 1, text.length);
  entry.at = (index) => map[index] ?? open;
  return entry.end;
}

// Scans code from `i`; inside ${…} (`brace`) it returns after the closing }.
function code(text: string, i: number, scan: Scan, brace = false): number {
  let depth = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === "'" || c === '"' || c === "`") {
      i = literal(text, i, scan);
    } else if (c === "/" && REGEX_AFTER.test(text.slice(Math.max(0, i - 12), i))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        else if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j++;
      }
      for (let k = i + 1; k < j; k++) scan.masked[k] = " ";
      i = j + 1;
    } else {
      if (brace && c === "{") depth++;
      if (brace && c === "}" && depth-- === 0) return i + 1;
      i++;
    }
  }
  return i;
}

function scanned(text: string): Scan {
  const scan: Scan = { strings: [], masked: text.split("") };
  code(text, 0, scan);
  return scan;
}

export function tsStrings(text: string): TsString[] {
  return scanned(text).strings;
}

const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

export function tsArgvArrays(text: string): ArgvArray[] {
  const scan = scanned(text);
  const masked = scan.masked.join("");
  const byStart = new Map(scan.strings.map((s) => [s.start, s]));
  const arrays: ArgvArray[] = [];
  for (let open = masked.indexOf("["); open >= 0; open = masked.indexOf("[", open + 1)) {
    const first = /\S/.exec(masked.slice(open + 1));
    if (!first || !"'\"".includes(first[0])) continue;
    const elements: ArgvElement[] = [];
    const stack: string[] = [];
    let from = open + 1;
    for (let i = open + 1; i < masked.length; i++) {
      const c = masked[i] ?? "";
      if (CLOSE[c]) stack.push(CLOSE[c]);
      else if (stack.length > 0 && c === stack.at(-1)) stack.pop();
      else if (stack.length === 0 && (c === "," || c === "]")) {
        const raw = text.slice(from, i);
        const lead = raw.length - raw.trimStart().length;
        const s = byStart.get(from + lead);
        const trimmed = raw.trim();
        if (s && !s.interpolated && s.end === from + lead + trimmed.length) {
          elements.push({ literal: s.body });
        } else if (trimmed) {
          elements.push({ expr: trimmed });
        }
        from = i + 1;
        if (c === "]") break;
      }
    }
    arrays.push({ index: open, elements });
  }
  return arrays;
}
