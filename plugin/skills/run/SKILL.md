---
name: run
description: Run a task on the Mac mini through mini-op. Loads its rules, finds the task's runbook (the request's, the current project's, the plugin's, or a one-off) and names it in the result.
---

# Run a task on the mini

1. Read `/opt/windroc/plugins/mini-op/CLAUDE.md` and follow its hard rules and routes. Then read these sections of `/opt/windroc/plugins/mini-op/README.md`: Rules, Driving the mini (with Browser and Waiting and answering), Scripts and Gotchas. The paths they name are relative to `/opt/windroc/plugins/mini-op/`.
2. Run `/opt/windroc/plugins/mini-op/ctl/mini sync --check`; if it fails, run `/opt/windroc/plugins/mini-op/ctl/mini sync`.
3. Call mini-op's tools only by their absolute path under `/opt/windroc/plugins/mini-op/ctl/`, never by a bare name, a path relative to the working directory or a file in the home directory.
4. Find the runbook. The first of these that gives one wins:
   1. The request holds the runbook's steps inline: use them.
   2. The request names a runbook: run `/opt/windroc/plugins/mini-op/ctl/runbook path <name>`, adding `--project <project>` when the request names a project. It prints the runbook's source and path, tab-separated. If it exits 1 with `no runbook named <name>`, say so in the result and go on to the next step.
   3. Run `/opt/windroc/plugins/mini-op/ctl/runbook list`, adding `--project <project>` when the request names a project. Each line is a runbook's source, path and `when`, tab-separated: the current project's runbooks first, then the plugin's. Choose by the `when` values alone, and open only the chosen runbook's file, never the others.
   4. No `when` fits: write a one-off runbook, numbered steps for this request, then follow it.

   Exit 3 from `runbook` means several project snapshots and none named: ask the user which project, and run nothing until they answer. Any other exit 1: report its message and run nothing.
5. Do the request, following the runbook.
6. Start the result, success or failure, with one line naming the runbook used:
   - `Runbook: inline (request)`
   - `Runbook: plugin <path>` or `Runbook: project:<name> <path>`: the source and path `runbook` printed
   - `Runbook: one-off (full text below)`

   Then repeat every `runbook: skipped …` line `runbook` printed, then the outcome. A one-off result ends with the runbook's full text in a fenced block, and says the user may commit it into the project's runbooks as `<name>.md` with a `when` line in its frontmatter.
