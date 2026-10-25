// What counts as a secret source in shell (FR-35, FR-36): security find-…-password with -w or -g,
// pbpaste, and the secrets dir, by name or through a variable holding a path in it. Built from
// parts so this file never matches itself.
import { SECRETS_LITERAL as SECRETS_DIR } from "./literals.ts";
import type { Command, ShellView } from "./shell.ts";

const RESOLVER = "$(secrets_" + "dir)";
const PATH_VAR = /(?:^|[\s;&|(])(?:local\s+|typeset\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\S*)/g;

export type Scope = { paths: Set<string> };

// Whether a word names the secrets dir or a variable holding a path in it.
export function secretPath(word: string, scope: Scope): boolean {
  if (word.includes(SECRETS_DIR) || word.includes(RESOLVER)) return true;
  return [...scope.paths].some((name) => new RegExp(`\\$\\{?${name}\\b`).test(word));
}

// The variables a file's views assign a secrets dir path to.
export function secretScope(views: ShellView[]): Scope {
  const scope: Scope = { paths: new Set() };
  for (const view of views) {
    for (const m of view.text.matchAll(PATH_VAR)) {
      if (secretPath(m[2] ?? "", { paths: new Set() })) scope.paths.add(m[1] ?? "");
    }
  }
  return scope;
}

// Whether a command reads a secret: runs a source, or names the secrets dir in a word or a <.
export function reads(command: Command, scope: Scope): boolean {
  return (
    secretSource(command) ||
    command.words.some((w) => secretPath(w, scope)) ||
    command.redirects.some((r) => r.op.endsWith("<") && secretPath(r.target, scope))
  );
}

// Commands that copy a named file's content out; [ -r "$pwfile" ] or echo "$pwfile" only name it.
const COPIERS = new Set(["cat", "head", "tail", "cp", "base64", "od", "xxd", "tee", "dd"]);

// Whether a script holding this command reads a secret itself: a source, a < from the secrets
// dir, or a copier given a path in it.
export function readsHere(command: Command, scope: Scope): boolean {
  return (
    secretSource(command) ||
    command.redirects.some((r) => r.op.endsWith("<") && secretPath(r.target, scope)) ||
    (COPIERS.has(command.name) && command.words.some((w) => secretPath(w, scope)))
  );
}

// Whether a command's stdin holds a secret: a pipe chain from a command that reads one, or a <
// from the secrets dir or from a <( ) that reads one. `all`: the commands of its view.
export function fedSecret(command: Command, all: Command[], scope: Scope): boolean {
  return pipedSecret(command, all, scope) || redirectedSecret(command, all, scope);
}

// A pipe chain into the command from a command or block that reads a secret.
function pipedSecret(command: Command, all: Command[], scope: Scope): boolean {
  for (let p = command.prev; p?.terminator === "|"; p = p.prev) {
    if (reads(p, scope) || (p.group && inside(all, p.group).some((n) => reads(n, scope)))) {
      return true;
    }
  }
  return false;
}

// A < from the secrets dir or from a <( ) that reads a secret.
function redirectedSecret(command: Command, all: Command[], scope: Scope): boolean {
  return command.redirects.some(
    (r) =>
      r.op.endsWith("<") &&
      (secretPath(r.target, scope) ||
        all.some(
          (n) =>
            n.opener === "<(" &&
            n.index >= r.index &&
            n.index < r.index + r.target.length &&
            reads(n, scope),
        )),
  );
}

type Block = { from: number; to: number };

const inside = (all: Command[], group: Block) =>
  all.filter((n) => n.index > group.from && n.index < group.to);

// The closers of the blocks ({ } groups, ( ) subshells, loops) a command runs in, innermost first.
export const enclosing = (all: Command[], command: Command) =>
  all
    .filter((c) => c.group && c.group.from < command.index && command.index < c.group.to)
    .sort((a, b) => (b.group?.from ?? 0) - (a.group?.from ?? 0));

// Whether a pipe from before a block feeds it: the block's first command with a prev has it from
// outside the block (`pbpaste | while read l; do`; a while marker has no prev itself).
function pipedInto(all: Command[], group: Block, scope: Scope): boolean {
  const first = all.find((n) => n.index >= group.from && n.index < group.to && n.prev);
  return (
    first?.prev !== undefined && first.prev.index < group.from && pipedSecret(first, all, scope)
  );
}

// Every command whose stdin holds a secret: fed itself, or run inside a loop or group whose
// closer is fed (`while read l; do x; done < "$pwfile"`) or that a pipe feeds (`pbpaste | while …`).
export function stdinFed(all: Command[], scope: Scope): Set<Command> {
  const fed = new Set(all.filter((c) => fedSecret(c, all, scope)));
  for (const c of all) {
    if (c.kind === "close" && c.group && (fed.has(c) || pipedInto(all, c.group, scope))) {
      for (const n of inside(all, c.group)) fed.add(n);
    }
  }
  return fed;
}

// The one keychain reader (FR-55): its keychain_read prints a password, as security -w does.
export const KEYCHAIN = "mini/lib/keychain.zsh";

// A command printing a secret: pbpaste, keychain_read, or security find-…-password with -w or -g.
export function secretSource(command: Command): boolean {
  if (command.name === "pbpaste" || command.name === "keychain_read") return true;
  return (
    command.name === "security" &&
    command.words.some((w) => /^find-[a-z]+-password$/.test(w)) &&
    command.words.some((w) => /^-[a-z]*[wg]/.test(w))
  );
}
