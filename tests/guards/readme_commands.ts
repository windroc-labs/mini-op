import type { Guard, Violation } from "../lib/guard.ts";
import { steps, workflows } from "../lib/workflows.ts";

const README = "README.md";
const SECTION = /^## Offline checks\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const BLOCK = /^```sh\n([\s\S]*?)^```/m;

// README › Offline checks is the one list of local checks; CI runs each command in it verbatim.
export const guard: Guard = {
  name: "readme_commands",
  check(view) {
    const found: Violation[] = [];
    const at = (file: string, message: string) => found.push({ file, line: 1, message });
    const block = BLOCK.exec(SECTION.exec(view.read(README))?.[1] ?? "")?.[1];
    if (block === undefined) {
      at(README, "Offline checks has no ```sh block of commands");
      return found;
    }
    const commands = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const runs = new Set(
      workflows(view).flatMap((wf) =>
        Object.values(wf.data.jobs ?? {}).flatMap((job) => steps(job).map((s) => s.run?.trim())),
      ),
    );
    for (const command of commands) {
      if (!runs.has(command)) at(README, `\`${command}\` is not a CI step run verbatim`);
    }
    if (!commands.includes("npm test")) at(README, "Offline checks does not list npm test");
    const scripts = (JSON.parse(view.read("package.json")).scripts ?? {}) as Record<string, string>;
    if (
      !/node --test\b/.test(scripts.test ?? "") ||
      !(scripts.test ?? "").includes("'tests/**/*.test.ts'")
    ) {
      at("package.json", "npm test must run node --test over 'tests/**/*.test.ts'");
    }
    return found;
  },
};
