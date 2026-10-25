import * as path from "node:path";
import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { loadIsolationExempt } from "../lib/registry.ts";
import { scanned } from "../lib/repo.ts";

// The sandbox infrastructure: the only test modules that start processes.
const INFRA = new Set(["tests/lib/sandbox.ts", "tests/lib/repo.ts", "tests/lib/fake.ts"]);
const BANNED = new Set(
  "child_process net http https http2 dgram tls dns worker_threads cluster".split(" "),
);
const IMPORT =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bgetBuiltinModule\s*\(\s*)["'`]([^"'`]+)["'`]/g;
const BINDING = new RegExp("process\\." + "binding\\b", "g");

export const guard: Guard = {
  name: "test_isolation",
  check(view) {
    const found: Violation[] = [];
    const exempt = loadIsolationExempt(view.read);
    if (!Array.isArray(exempt) || exempt.length > 0) {
      found.push({
        file: "tests/registry/isolation-exempt.json",
        line: 1,
        message: "the sandbox exemption list must stay empty",
      });
    }
    for (const file of scanned(view)) {
      if (!file.startsWith("tests/") || !file.endsWith(".ts") || INFRA.has(file)) continue;
      const text = view.read(file);
      for (const match of text.matchAll(IMPORT)) {
        const spec = match[1] ?? "";
        const line = lineAt(text, match.index);
        if (BANNED.has(spec.replace(/^node:/, "").split("/")[0] ?? "")) {
          found.push({ file, line, message: `imports ${spec}; run processes through Sandbox.run` });
        } else if (spec.startsWith(".")) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
          if (!target.startsWith("tests/")) {
            found.push({
              file,
              line,
              message: `imports ${spec} from outside tests/; run it in a Sandbox`,
            });
          }
        }
      }
      for (const match of text.matchAll(BINDING)) {
        found.push({ file, line: lineAt(text, match.index), message: "uses process bindings" });
      }
    }
    return found;
  },
};
