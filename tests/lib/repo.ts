// Repository layout facts and file views shared by the sandbox, guards and CI helpers.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Dirs whose files ship to the container, the MacBook or the mini; read-only while CI tests run.
export const SHIPPED_DIRS = ["ctl", "mini", "host", "plugin"];

// Dirs whose scripts and program entries each need a test (FR-26): the shipped dirs and CI's own.
export const TESTED_DIRS = [...SHIPPED_DIRS, ".github", ".githooks"];

// The mini's copy of mini/: these dirs land under ~/apm.
export const APM_DIRS = ["bin", "js", "lib", "ts", "runbooks"];

// Where a mini/ file lives on the mini, as scripts and docs name it.
export function apmPath(file: string): string | undefined {
  return file.startsWith("mini/") ? `~/apm/${file.slice("mini/".length)}` : undefined;
}

// Guard samples hold deliberate violations; guards scanning the repo skip them.
export const SAMPLES_DIR = "tests/guards/samples/";

const WALK_SKIP = new Set([".git", "node_modules", ".tools", ".updraft"]);

// local: the user's ~/.mini-op/config.local.yaml (text null: unreadable), set by guards/run.ts only.
export type LocalFile = { path: string; text: string | null };
export type RepoView = {
  root: string;
  files: string[];
  read(file: string): string;
  local?: LocalFile;
};

// Shipped code: any non-Markdown file under a shipped dir.
export function isShipped(file: string): boolean {
  return SHIPPED_DIRS.some((dir) => file.startsWith(dir + "/")) && !file.endsWith(".md");
}

function walk(root: string, dir = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!WALK_SKIP.has(entry.name)) files.push(...walk(root, rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

// Tracked and untracked-but-not-ignored files of a checkout, or every file of a plain directory.
export function fromRoot(root: string): RepoView {
  let files: string[];
  if (fs.existsSync(path.join(root, ".git"))) {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "utf8",
    });
    files = out.split("\0").filter((file) => file && fs.existsSync(path.join(root, file)));
  } else {
    files = walk(root);
  }
  return {
    root,
    files: [...new Set(files)].sort(),
    read: (file) => fs.readFileSync(path.join(root, file), "utf8"),
  };
}

// A checkout's `git status` lines, ignored and untracked files one by one: what a run changed
// in it shows as a line added or gone.
export function checkoutStatus(root: string): string[] {
  const args = ["-C", root, "status", "--porcelain", "--ignored", "--untracked-files=all"];
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

export function fromFiles(files: Record<string, string>): RepoView {
  return {
    root: "",
    files: Object.keys(files).sort(),
    read: (file) => {
      const text = files[file];
      if (text === undefined) throw new Error(`ENOENT: no such file ${file}`);
      return text;
    },
  };
}

// The files content-scanning guards look at: everything but the guard samples.
export function scanned(view: RepoView): string[] {
  return view.files.filter((file) => !file.startsWith(SAMPLES_DIR));
}

export type ShellKind = "zsh" | "bash" | "sh";

export function shellKind(file: string, text: string): ShellKind | null {
  const shebang = /^#!\s*(\S+)(.*)$/m.exec(text.split("\n", 1)[0] ?? "");
  if (shebang) {
    let interpreter = path.basename(shebang[1] ?? "");
    if (interpreter === "env") {
      interpreter =
        (shebang[2] ?? "")
          .trim()
          .split(/\s+/)
          .find((arg) => !arg.startsWith("-")) ?? "";
    }
    return interpreter === "zsh" || interpreter === "bash" || interpreter === "sh"
      ? interpreter
      : null;
  }
  const ext = path.extname(file).slice(1);
  return ext === "zsh" || ext === "bash" || ext === "sh" ? ext : null;
}
