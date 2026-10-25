import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { scanned } from "../lib/repo.ts";
import { steps, workflows } from "../lib/workflows.ts";

const EXACT = /^\d+\.\d+\.\d+$/;
const DEPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const RELEASE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//;

export const guard: Guard = {
  name: "tool_pins",
  check(view) {
    const found: Violation[] = [];
    const files = scanned(view);
    if (files.includes("package.json")) {
      const pkg = JSON.parse(view.read("package.json")) as Record<string, Record<string, string>>;
      for (const kind of DEPS) {
        for (const [name, version] of Object.entries(pkg[kind] ?? {})) {
          if (!EXACT.test(version)) {
            found.push({
              file: "package.json",
              line: 1,
              message: `${name} ${version} is not an exact version`,
            });
          }
        }
      }
      if (!files.includes("package-lock.json")) {
        found.push({
          file: "package.json",
          line: 1,
          message: "no package-lock.json pins the dependency tree",
        });
      }
    }
    if (files.includes(".node-version") && !EXACT.test(view.read(".node-version").trim())) {
      found.push({
        file: ".node-version",
        line: 1,
        message: "node is not pinned to an exact version",
      });
    }
    if (files.includes(".github/tools.tsv")) {
      view
        .read(".github/tools.tsv")
        .split("\n")
        .forEach((row, i) => {
          if (i === 0 || !row.trim()) return;
          const [name, version = "", , sha = "", url = ""] = row.split("\t");
          const at = (message: string) =>
            found.push({ file: ".github/tools.tsv", line: i + 1, message: `${name}: ${message}` });
          if (!/^v?\d+\.\d+\.\d+$/.test(version)) at(`${version} is not an exact version`);
          if (!/^[0-9a-f]{64}$/.test(sha)) at("sha256 is not 64 hex digits");
          if (!RELEASE.test(url) || !url.includes(version)) {
            at("url is not a GitHub release download of the pinned version");
          }
        });
    }
    for (const wf of workflows(view)) {
      for (const match of wf.text.matchAll(/\blatest\b/g)) {
        found.push({ file: wf.file, line: lineAt(wf.text, match.index), message: "uses 'latest'" });
      }
      for (const job of Object.values(wf.data.jobs ?? {})) {
        for (const step of steps(job)) {
          for (const [key, value] of Object.entries(step.with ?? {})) {
            if (key.endsWith("-version") && !EXACT.test(String(value))) {
              found.push({
                file: wf.file,
                line: 1,
                message: `${key}: ${value} is not an exact version`,
              });
            }
          }
          const run = step.run ?? "";
          if (/\bnpm ci\b/.test(run) && !/--ignore-scripts\b/.test(run)) {
            found.push({ file: wf.file, line: 1, message: "npm ci without --ignore-scripts" });
          }
          if (/\b(npx|npm (install|i|exec))\b/.test(run)) {
            found.push({ file: wf.file, line: 1, message: `unpinned install: ${run.trim()}` });
          }
        }
      }
    }
    return found;
  },
};
