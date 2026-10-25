---
name: run
description: Run a task on the Mac mini through mini-op, under its hard rules and routes.
---

# Run a task on the mini

1. Read `/opt/windroc/plugins/mini-op/CLAUDE.md` and follow its hard rules and routes. The paths it names are relative to `/opt/windroc/plugins/mini-op/`.
2. Run `/opt/windroc/plugins/mini-op/ctl/mini sync --check`; if it fails, run `/opt/windroc/plugins/mini-op/ctl/mini sync`.
3. Call mini-op's tools only by their absolute path under `/opt/windroc/plugins/mini-op/ctl/`, never by a bare name, a path relative to the working directory or a file in the home directory.
4. Then do the request.
