// Every piece of shell in the repo, for the guards that read commands: shell files by shebang or
// extension, Dockerfile RUN bodies and workflow run steps, each as shell views at file offsets.
import { scanned, shellKind, type RepoView } from "./repo.ts";
import { shellViews, type ShellView } from "./shell.ts";
import { steps, workflows } from "./workflows.ts";

export type ShellSource = { file: string; views: ShellView[] };

// A Dockerfile's RUN instructions: from after RUN to the first line not ending in \.
function dockerRuns(text: string): ShellView[] {
  const views: ShellView[] = [];
  for (const match of text.matchAll(/^RUN[ \t]+/gm)) {
    const start = match.index + match[0].length;
    let end = start;
    for (;;) {
      const next = text.indexOf("\n", end);
      const stop = next < 0 ? text.length : next;
      end = stop;
      if (!/\\\s*$/.test(text.slice(start, stop)) || next < 0) break;
      end = next + 1;
    }
    views.push(...shellViews(text.slice(start, end), (i) => start + i));
  }
  return views;
}

// A run step's text, each line mapped to where YAML (which strips block indentation) has it.
function runView(text: string, run: string, cursor: { at: number }): ShellView[] {
  const offsets: number[] = [];
  for (const line of run.split("\n")) {
    const found = line.trim() ? text.indexOf(line, cursor.at) : -1;
    if (found >= 0) cursor.at = found + line.length;
    for (let k = 0; k <= line.length; k++) offsets.push((found >= 0 ? found : cursor.at) + k);
  }
  return shellViews(run, (i) => offsets[i] ?? cursor.at);
}

export function shellSources(view: RepoView): ShellSource[] {
  const sources: ShellSource[] = [];
  for (const flow of workflows(view)) {
    const cursor = { at: 0 };
    const views = Object.values(flow.data.jobs ?? {}).flatMap((job) =>
      steps(job).flatMap((step) =>
        typeof step.run === "string" ? runView(flow.text, step.run, cursor) : [],
      ),
    );
    sources.push({ file: flow.file, views });
  }
  for (const file of scanned(view)) {
    const text = view.read(file);
    if (/(^|\/)Dockerfile$/.test(file)) sources.push({ file, views: dockerRuns(text) });
    else if (shellKind(file, text)) sources.push({ file, views: shellViews(text) });
  }
  return sources;
}

// Every doc's shell but the tests' docs, as sources.
export function docShellSources(view: RepoView): ShellSource[] {
  return scanned(view)
    .filter((file) => file.endsWith(".md") && !file.startsWith("tests/"))
    .map((file) => ({ file, views: docShellViews(view.read(file)) }));
}

const FENCE = /^```/;

// A doc's shell: each inline code span and each fenced block (its lines between the fences, so a
// loop spread over them is one command), as shell views at their file offsets.
export function docShellViews(text: string): ShellView[] {
  const views: ShellView[] = [];
  let offset = 0;
  let block: number | undefined;
  const flush = (end: number) => {
    if (block !== undefined && end > block) {
      const start = block;
      views.push(...shellViews(text.slice(start, end), (i) => start + i));
    }
    block = undefined;
  };
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      if (block === undefined) block = offset + line.length + 1;
      else flush(offset - 1);
    } else if (block === undefined) {
      for (const span of line.matchAll(/`([^`]+)`/g)) {
        const start = offset + span.index + 1;
        views.push(...shellViews(span[1] ?? "", (i) => start + i));
      }
    }
    offset += line.length + 1;
  }
  flush(text.length);
  return views;
}
