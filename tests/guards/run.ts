// node tests/guards/run.ts [--root <dir>]: run every guard over the checkout (default: this one).
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { runGuards } from "../lib/guard.ts";
import { REPO, fromRoot } from "../lib/repo.ts";
import { guards } from "./index.ts";

const { values } = parseArgs({ options: { root: { type: "string" } } });
const view = fromRoot(values.root ?? REPO);
// The address guard also checks the real values, where this Mac has them.
const local = path.join(process.env.HOME ?? "", ".mini-op/config.local.yaml");
if (process.env.HOME && fs.existsSync(local)) {
  let text: string | null = null;
  try {
    text = fs.readFileSync(local, "utf8");
  } catch {}
  view.local = { path: local, text };
}
process.exitCode = runGuards(view, guards, (text) => process.stdout.write(text));
