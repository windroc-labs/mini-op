// GitHub Actions workflow files, parsed for the guards that check them.
import { parse } from "yaml";
import type { RepoView } from "./repo.ts";
import { scanned } from "./repo.ts";

export type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
export type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  permissions?: unknown;
  "timeout-minutes"?: unknown;
  steps?: Step[];
};
export type Workflow = {
  file: string;
  text: string;
  data: {
    on?: Record<string, unknown>;
    permissions?: unknown;
    concurrency?: Record<string, unknown>;
    jobs?: Record<string, Job>;
  };
};

export const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function workflows(view: RepoView): Workflow[] {
  return scanned(view)
    .filter((file) => WORKFLOW_FILE.test(file))
    .map((file) => {
      const text = view.read(file);
      return { file, text, data: (parse(text) ?? {}) as Workflow["data"] };
    });
}

export function steps(job: Job): Step[] {
  return Array.isArray(job.steps) ? job.steps : [];
}
