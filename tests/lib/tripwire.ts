// The tripwire: shipped files a test must never run until their ticket fixes them, and strings
// naming the real secrets dir.
import * as fs from "node:fs";
import * as path from "node:path";
import { SECRETS_LITERAL } from "./literals.ts";
import { prependsPath } from "./path_bypass.ts";
import { loadPathBypass, loadSecrets } from "./registry.ts";
import { apmPath, isShipped } from "./repo.ts";

export class SandboxError extends Error {}

// Names a repo path or command name as a whole word, so `mini/bin/o` does not match `mini/bin/open`.
export function names(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}($|[^A-Za-z0-9_.-])`).test(text);
}

// Shipped files a test must never run until their ticket fixes them: they read the real secrets
// dir or find tools ahead of PATH (tests/registry/secrets.json, path-bypass.json). A registered
// file that only appends to PATH runs: the sandbox's fakes stay first.
export class Tripwire {
  private readonly readers: string[];
  private readonly bypassers: string[];
  private readonly allowed: string[];
  private readonly repo: string;

  constructor(repo: string) {
    this.repo = repo;
    const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");
    const secrets = loadSecrets(read);
    this.readers = secrets.literal.filter((entry) => entry.reads).map((entry) => entry.file);
    const runs = (file: string) =>
      fs.existsSync(path.join(repo, file)) && !prependsPath(read(file));
    this.bypassers = loadPathBypass(read)
      .map((entry) => entry.file)
      .filter((file) => !runs(file));
    this.allowed = [
      secrets.resolver,
      ...secrets.literal.filter((e) => !e.reads).map((e) => e.file),
    ];
  }

  // Why a string must not run: it names the real secrets dir, a registered reader (by path,
  // basename or ~/apm path) or a registered PATH bypass (by path or ~/apm path).
  trips(text: string): string | undefined {
    if (text.includes(SECRETS_LITERAL)) return `names the real secrets dir ${SECRETS_LITERAL}`;
    const forms = (f: string) => [f, apmPath(f)].filter((w): w is string => w !== undefined);
    const reader = this.readers.find((f) =>
      [...forms(f), path.basename(f)].some((w) => names(text, w)),
    );
    if (reader) return `names registered secrets reader ${reader}`;
    const bypasser = this.bypassers.find((f) => forms(f).some((w) => names(text, w)));
    if (bypasser) return `names registered PATH bypass ${bypasser}`;
    return undefined;
  }

  // Why a repo file must not run, `rel` relative to the repo.
  fileTrips(rel: string, text: string): string | undefined {
    if (this.readers.includes(rel)) return `${rel} is a registered secrets reader`;
    if (this.bypassers.includes(rel)) return `${rel} is a registered PATH bypass`;
    if (isShipped(rel) && !this.allowed.includes(rel) && text.includes(SECRETS_LITERAL)) {
      return `${rel} names ${SECRETS_LITERAL} and is unregistered`;
    }
    return undefined;
  }

  check(strings: string[], files: string[]): void {
    for (const text of strings) {
      const reason = this.trips(text);
      if (reason) throw new SandboxError(`sandbox: run ${reason}`);
    }
    for (const file of files) {
      const reason = this.fileTrips(path.relative(this.repo, file), fs.readFileSync(file, "utf8"));
      if (reason) throw new SandboxError(`sandbox: ${reason}`);
    }
  }
}
