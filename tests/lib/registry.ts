// The one loader for tests/registry/*.json, the registered exceptions guards and the sandbox share.

export type Read = (file: string) => string;

export type SecretsRegistry = {
  variable: string;
  resolver: string;
  literal: { file: string; reads: boolean; reason: string }[];
};

export type FileReason = { file: string; reason: string };

function load<T>(read: Read, name: string): T {
  return JSON.parse(read(`tests/registry/${name}`)) as T;
}

export const loadSecrets = (read: Read) => load<SecretsRegistry>(read, "secrets.json");
export const loadPathBypass = (read: Read) => load<FileReason[]>(read, "path-bypass.json");
export const loadUntested = (read: Read) => load<FileReason[]>(read, "untested.json");
export const loadAppleScript = (read: Read) => load<FileReason[]>(read, "applescript.json");

// A block of `file` that repeats one of `repeats`, from its first normalized line `text` (FR-72).
export type Duplicate = { file: string; repeats: string; text: string; reason: string };

export const loadDuplicates = (read: Read) => load<Duplicate[]>(read, "duplicates.json");

export type NonCode = { file: string; reason: string; tests: string[] };

export const loadNonCode = (read: Read) => load<NonCode[]>(read, "non-code.json");

export type Suppression = { file: string; text: string; reason: string };
// argv: a secret that has no way in but argv, passed on the one line holding text (FR-58).
export type SecretRead = Suppression & { argv?: boolean };

export const loadSuppressions = (read: Read) => load<Suppression[]>(read, "suppressions.json");
export const loadSecretReads = (read: Read) => load<SecretRead[]>(read, "secret-reads.json");

// What text-keyed registries (suppressions, secret reads) check of every row alike: its key, and
// whether it repeats an earlier row or has no reason. Each guard words its own messages.
export function textRows<T extends Suppression>(rows: T[]) {
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = `${row.file}\0${row.text}`;
    const duplicate = seen.has(key);
    seen.add(key);
    return { row, key, duplicate, reasonless: !row.reason?.trim() };
  });
}
export const loadIsolationExempt = (read: Read) => load<unknown[]>(read, "isolation-exempt.json");
