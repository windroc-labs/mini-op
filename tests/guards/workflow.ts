import { isDeepStrictEqual } from "node:util";
import { lineAt, type Guard, type Violation } from "../lib/guard.ts";
import { SHIPPED_DIRS } from "../lib/repo.ts";
import { steps, workflows, type Job } from "../lib/workflows.ts";

// The last step of every job that checks out: tests and tools must leave the checkout as it was.
export const UNCHANGED =
  'test -z "$(git status --porcelain --untracked-files=all)" || { git status --short; exit 1; }';
// The runs of the TS suite, which must find shipped code read-only. The Python transition tests copy
// shipped dirs and edit the copies, so they run writable.
const TEST_RUNS = ["npm test", "npm run coverage", "node --test"];
const DOWNLOAD = /\b(?:curl|wget)\b/;
const VERIFIED = /\bsha256sum\s+(?:--check|-c)\b/;
const MAX_MINUTES = 15;

export const guard: Guard = {
  name: "workflow",
  check(view) {
    const found: Violation[] = [];
    const all = workflows(view);
    if (!all.some((wf) => wf.file === ".github/workflows/ci.yml")) {
      found.push({
        file: ".github/workflows/ci.yml",
        line: 1,
        message: "the CI workflow is missing",
      });
    }
    const shipped = SHIPPED_DIRS.filter((dir) => view.files.some((f) => f.startsWith(dir + "/")));
    const chmod = `chmod -R a-w ${[...shipped].sort().join(" ")}`;
    for (const wf of all) {
      const at = (message: string, line = 1) => found.push({ file: wf.file, line, message });
      const on = wf.data.on ?? {};
      const push = (on.push ?? {}) as { branches?: unknown };
      if (!("pull_request" in on)) at("does not run on pull_request");
      if (!isDeepStrictEqual(push.branches, ["main"])) at("does not run on push to main");
      if (!isDeepStrictEqual(wf.data.permissions, { contents: "read" })) {
        at("permissions must be exactly contents: read");
      }
      const concurrency = wf.data.concurrency ?? {};
      if (
        !String(concurrency.group ?? "").includes("github.event.pull_request.number") ||
        [undefined, false, "false"].includes(concurrency["cancel-in-progress"] as string)
      ) {
        at("a new push must cancel the PR's running workflow (concurrency)");
      }
      for (const match of wf.text.matchAll(/\$\{\{[^}]*\bsecrets\b/g)) {
        at("references secrets", lineAt(wf.text, match.index));
      }
      const jobs = Object.entries(wf.data.jobs ?? {});
      for (const [id, job] of jobs) checkJob(id, job, chmod, at);
      if (wf.file === ".github/workflows/ci.yml") checkSummary(jobs, at);
    }
    return found;
  },
};

function checkJob(id: string, job: Job, chmod: string, at: (message: string) => void): void {
  if (job.permissions !== undefined) at(`job ${id} sets its own permissions`);
  const minutes = job["timeout-minutes"];
  if (typeof minutes !== "number" || minutes > MAX_MINUTES) {
    at(`job ${id} needs timeout-minutes <= ${MAX_MINUTES}`);
  }
  const list = steps(job);
  const checkouts = list.filter((step) => step.uses?.startsWith("actions/checkout@"));
  for (const step of checkouts) {
    if (step.with?.["persist-credentials"] !== false) {
      at(`job ${id} checks out without persist-credentials: false`);
    }
  }
  const last = list.at(-1);
  if (
    checkouts.length > 0 &&
    (last?.name !== "Require unchanged checkout" || last.run !== UNCHANGED)
  ) {
    at(`job ${id} must end with the 'Require unchanged checkout' step`);
  }
  if (list.some((step) => DOWNLOAD.test(step.run ?? "") && !VERIFIED.test(step.run ?? ""))) {
    at(`job ${id} downloads without sha256sum -c`);
  }
  const tests = list.findIndex((step) =>
    TEST_RUNS.some((run) => (step.run?.trim() ?? "").startsWith(run)),
  );
  if (tests >= 0 && !list.slice(0, tests).some((step) => step.run?.trim() === chmod)) {
    at(`job ${id} must run '${chmod}' before its tests`);
  }
}

function checkSummary(jobs: [string, Job][], at: (message: string) => void): void {
  const summary = jobs.find(([, job]) => job.name === "CI");
  if (!summary) return at("no summary job named CI");
  const [id, job] = summary;
  const needs = new Set([job.needs ?? []].flat());
  const others = jobs.map(([other]) => other).filter((other) => other !== id);
  if (others.some((other) => !needs.has(other)) || needs.size !== others.length) {
    at("job CI must need every other job");
  }
  if (!String(job.if ?? "").includes("always()")) at("job CI must run if: always()");
  const fails = steps(job).some(
    (step) =>
      /contains\(needs\.\*\.result, 'failure'\)/.test(step.if ?? "") &&
      /contains\(needs\.\*\.result, 'cancelled'\)/.test(step.if ?? "") &&
      step.run?.trim() === "exit 1",
  );
  if (!fails) at("job CI must fail when a needed job failed or was cancelled");
}
