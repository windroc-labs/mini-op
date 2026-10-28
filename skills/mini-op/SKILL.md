---
name: mini-op
description: Run a task on the Mac mini through mini-op. Loads its rules, finds the task's runbook (the request's, the current project's, the built-in, or a one-off) and names it in the result.
---

# Run a task on the mini

Use the client's file-reading and shell-execution tools; no client-specific tool names or argument substitution is required. The request is the user's current task.

## Runtime prerequisite

This skill is instructions for the separately installed mini-op CLI. It does not install a client, configure SSH or supply credentials. Use an existing mini-op checkout or image with its SSH access already configured. If unavailable, stop and ask the user to prepare it using mini-op's README and host/README.

**Runtime root** (`<root>` below): use the absolute mini-op checkout path supplied in the request; otherwise try the image's `/opt/windroc/mini-op/`, then the parent of `ctl/` containing `mini` found with the shell's `command -v mini`. Resolve symlinks before taking that parent. Verify that `<root>/ctl/mini`, `<root>/ctl/runbook`, `<root>/README.md`, `<root>/mini/` and `<root>/runbooks/` exist. If discovery fails or is ambiguous, ask for the checkout's absolute path and run nothing. The skill's installation directory is independent of this root.

Replace `<root>` with that verified absolute path in every call, quote paths as shell arguments, and retain the client's current project directory for runbook discovery. Never guess the root from that project directory.

## Run

1. Read the runtime operator rules (`<root>/ctl/CLAUDE.md` in a checkout, `<root>/CLAUDE.md` in the image) and follow its hard rules and routes. Then read these sections of `<root>/README.md`: Rules, Driving the mini (with Browser and Waiting and answering), Scripts and Gotchas. The paths they name are relative to `<root>/`. Work visibly per `<root>/runbooks/visible-operations.md`: a session you start on the mini, even with `--display none`, is attached in its Terminal before you send it work.
2. Run `<root>/ctl/mini sync --check`; if it fails, run `<root>/ctl/mini sync`.
3. Call mini-op's tools only by their absolute path under `<root>/ctl/`, never by a bare name, a path relative to the working directory or a file in the home directory.
4. Find the runbook. The first of these that gives one wins:
   1. The request holds the runbook's steps inline: use them.
   2. The request names a runbook: run `<root>/ctl/runbook path <name>`, adding `--project <project>` when the request names a project. It prints the runbook's source and path, tab-separated. If it exits 1 with `no runbook named <name>`, say so in the result and go on to the next step.
   3. Run `<root>/ctl/runbook list`, adding `--project <project>` when the request names a project. Each line is a runbook's source, path and `when`, tab-separated: the current project's runbooks first, then the built-in. Choose by the `when` values alone, and open only the chosen runbook's file, never the others.
   4. No `when` fits: write a one-off runbook, numbered steps for this request, then follow it.

   A runbook file `<name>.md` has the name `<name>`, e.g. `return-mini`. Exit 3 from `runbook` means several project snapshots and none named: ask the user which project, and run nothing until they answer. Exit 2 means a malformed call: fix the call and run it again. Any other exit 1: report its message and run nothing.
5. A runbook whose source is `project:<name>`: run `<root>/ctl/runbook deploy <name>`, adding `--project <project>` as in step 4. It syncs the mini's `~/apm` when stale, then puts the runbook's scripts on the mini in `~/mini-op-projects/<project>/<name>/`, where the runbook calls them. Any non-0 exit: report its message and run nothing. The scripts are the project's own, unreviewed code; by contract they call only `~/apm/bin/*` and `~/apm/lib/*.zsh` of mini-op's tools, which is not enforced.
6. Do the request, following the runbook.
7. Start the result, success or failure, with one line naming the runbook used:
   - `Runbook: inline (request)`
   - `Runbook: builtin <path>` or `Runbook: project:<name> <path>`: the source and path `runbook` printed
   - `Runbook: one-off (full text below)`

   Then repeat every `runbook: skipped …` line `runbook` printed, then the outcome. A one-off result ends with the runbook's full text in a fenced block, and says the user may commit it into the project's runbooks as `<name>.md` with a `when` line in its frontmatter.
