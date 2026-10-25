// Commands found anywhere in the repo for the guards that judge them: in every shell source
// (tests/lib/scripts.ts) and in TS string literals read as shell, plus TS argv arrays.
import * as path from "node:path";
import { lineAt } from "./guard.ts";
import { scanned, type RepoView } from "./repo.ts";
import { shellSources } from "./scripts.ts";
import { commands, shellViews, type Command, type ShellView } from "./shell.ts";
import { tsArgvArrays, tsStrings, type ArgvElement } from "./ts_literals.ts";

export type Found = { file: string; line: number; command: Command; view: ShellView };
export type FoundArgv = { file: string; line: number; elements: ArgvElement[] };

// The command name as run: a path's basename.
export const commandName = (command: Command) => path.basename(command.name);

export function repoCommands(view: RepoView): Found[] {
  const found: Found[] = [];
  const add = (file: string, text: string, views: ShellView[]) => {
    for (const v of views) {
      for (const command of commands(v)) {
        found.push({ file, line: lineAt(text, v.at(command.index)), command, view: v });
      }
    }
  };
  for (const source of shellSources(view)) add(source.file, view.read(source.file), source.views);
  for (const file of scanned(view).filter((f) => f.endsWith(".ts"))) {
    const text = view.read(file);
    for (const s of tsStrings(text))
      add(
        file,
        text,
        shellViews(s.body, (i) => s.at(i)),
      );
  }
  return found;
}

export function repoArgv(view: RepoView): FoundArgv[] {
  return scanned(view)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const text = view.read(file);
      return tsArgvArrays(text).map((a) => ({
        file,
        line: lineAt(text, a.index),
        elements: a.elements,
      }));
    });
}
