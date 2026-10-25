---
when: cleaning ensemble off the mini (clean-test) and checking its login and launch items afterwards
---

# Clean ensemble off the mini

Rules, waiting and answering: `../README.md`.

1. Cleanup: `~/apm/runbooks/clean-ensemble/clean-test` (PR #547's `install-cleanup.sh --yes`). Homebrew's own uninstaller prints "Warning: This script will remove" and a list of not-deleted dirs: harmless. Afterwards check for leftovers (files, `.zprofile`, keychain items). Keep the `agentpm-test-*` items, `strata-api-key` and the `github.com` internet password for `dotpm2026` (git's, the user 2026-10-23).
2. Check the mini's login and launch items (TASK-892), after every test once mini-op is stopped (`host/stop`), against the same check saved before the test (and once before the first test, as the baseline). From this Mac's checkout, send each public read-only command as stdin to `ctl/mini exec` and save complete stdout to a file on this Mac outside this repo: `find /Library/LaunchAgents /Library/LaunchDaemons ~/Library/LaunchAgents -type f -exec shasum -a 256 {} +`, `launchctl print gui/$(id -u)`, `launchctl print system`, `ps -axo pid,ppid,user,command`. For `sudo sfltool dumpbtm`, use `ctl/mini run`; the user types the password at the mini's confirmed hidden sudo prompt (mini-op is stopped and has no password file). Record its marker result and save the public report on the mini for complete file readback. Every new or changed item and process must match this test's installs. Any unexplained difference, failed check or missing permission is an anomaly: keep mini-op stopped, tell the user, and do not adopt it as baseline (erase: `return-mini.md`). A clean result is no proof the mini is clean. Routes and exceptions: `visible-operations.md`.
