import type { Guard, Violation } from "../lib/guard.ts";

const GUARD = /^tests\/guards\/([a-z_]+)\.ts$/;
const NOT_GUARDS = new Set(["index", "run"]);

export const guard: Guard = {
  name: "guard_samples",
  check(view) {
    const found: Violation[] = [];
    const index = view.files.includes("tests/guards/index.ts")
      ? view.read("tests/guards/index.ts")
      : "";
    for (const file of view.files) {
      const name = GUARD.exec(file)?.[1];
      if (!name || NOT_GUARDS.has(name)) continue;
      const sample = `tests/guards/samples/${name}.ts`;
      if (!view.files.includes(sample)) {
        found.push({ file, line: 1, message: `no samples in ${sample}` });
      } else {
        const text = view.read(sample);
        for (const kind of ["violation", "clean", "expected"]) {
          if (!new RegExp(`^export const ${kind}\\b`, "m").test(text)) {
            found.push({ file: sample, line: 1, message: `no ${kind} sample` });
          }
        }
      }
      if (!index.includes(`"./${name}.ts"`)) {
        found.push({ file, line: 1, message: "not listed in tests/guards/index.ts" });
      }
    }
    return found;
  },
};
