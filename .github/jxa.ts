// node .github/jxa.ts [--root <dir>] [--write]: build each JXA entry mini/ts/<name>.ts on its own
// with mini/ts/jxa.d.ts, and each page program mini/ts/page/<name>.ts, and fail on a type error or
// unless mini/js holds exactly that output, byte for byte (FR-43); --write rewrites mini/js instead.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { REPO } from "../tests/lib/repo.ts";
import { build, drift, orphans } from "./lib/jxa.ts";

const USAGE = "usage: jxa [--root <dir>] [--write]";

function parse() {
  try {
    return parseArgs({
      options: { root: { type: "string" }, write: { type: "boolean", default: false } },
    }).values;
  } catch (err) {
    process.stderr.write(`jxa: ${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    process.exit(2);
  }
}

const values = parse();
const root = path.resolve(values.root ?? REPO);
const { outputs, errors } = build(root);
const report = (lines: string[]) => {
  for (const line of lines) process.stderr.write(`jxa: ${line}\n`);
};
if (errors.length > 0) {
  report(errors);
  process.exit(1);
}
if (values.write) {
  for (const file of orphans(root, outputs)) fs.rmSync(path.join(root, file));
  for (const [file, text] of outputs) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
} else {
  const found = drift(root, outputs);
  report(found);
  process.exitCode = found.length > 0 ? 1 : 0;
}
