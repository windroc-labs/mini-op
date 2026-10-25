// The pinned binary tools of .github/tools.tsv, as installed by `.github/tools install`.
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO } from "../../tests/lib/repo.ts";

export const TOOLS_DIR = path.join(REPO, ".tools");

const PLATFORM = `${process.platform}-${process.arch}`;

export class ToolMissing extends Error {}

// The path of a pinned tool, after checking its stamp matches the manifest row for this platform.
export function toolPath(name: string, toolsDir = TOOLS_DIR): string {
  const rows = fs
    .readFileSync(path.join(REPO, ".github/tools.tsv"), "utf8")
    .split("\n")
    .map((line) => line.split("\t"));
  const row = rows.find(([tool, , platform]) => tool === name && platform === PLATFORM);
  if (!row) throw new ToolMissing(`${name} has no ${PLATFORM} build in .github/tools.tsv`);
  const [, version, , sha] = row;
  const bin = path.join(toolsDir, "bin", name);
  let stamp = "";
  try {
    stamp = fs.readFileSync(path.join(toolsDir, `${name}.version`), "utf8").trim();
  } catch {
    // missing stamp: reported below
  }
  if (!fs.existsSync(bin) || stamp !== `${version} ${sha}`) {
    throw new ToolMissing(
      `${name} ${version} is missing from ${toolsDir}; run .github/tools install`,
    );
  }
  return bin;
}
