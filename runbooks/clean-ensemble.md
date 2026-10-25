---
when: cleaning ensemble off the mini (clean-test) and checking its login and launch items afterwards
---

# Clean ensemble off the mini

Rules, waiting and answering: `../README.md`.

1. Cleanup: `~/apm/runbooks/clean-ensemble/clean-test` (PR #547's `install-cleanup.sh --yes --password-stdin`). Homebrew's own uninstaller prints "Warning: This script will remove" and a list of not-deleted dirs: harmless. Afterwards check for leftovers (files, `.zprofile`, keychain items). Keep the `ensemble-test-*` items, `strata-api-key` and the `github.com` internet password for `dotpm2026` (git's, the user 2026-10-23).
2. Check the mini's login and launch items (TASK-892), after every test once mini-op is stopped (`host/stop`), against the same check saved before the test (and once before the first test, as the baseline). Read-only, over ssh from this Mac in this repo's checkout, each output saved to a file on this Mac outside this repo: `ssh -F ~/.mini-op/ssh_config mini 'find /Library/LaunchAgents /Library/LaunchDaemons ~/Library/LaunchAgents -type f -exec shasum -a 256 {} +'`, `ssh -F ~/.mini-op/ssh_config mini 'launchctl print gui/$(id -u)'`, `ssh -F ~/.mini-op/ssh_config mini 'launchctl print system'`, `ssh -F ~/.mini-op/ssh_config mini 'ps -axo pid,ppid,user,command'`, and `sfltool dumpbtm` as root, the user typing the mini's password at sudo's prompt (mini-op is stopped, so it has no `/run/secrets/mini-password`): `ssh -F ~/.mini-op/ssh_config -t mini 'sudo sfltool dumpbtm'`. Every new or changed launch agent, daemon, login or background item and process must match what this test installed. Anything else, or a check that failed or lacked permission, is an anomaly: keep mini-op stopped, tell the user, and do not take it as the new baseline (erase: `return-mini.md`). A clean result is no proof the mini is clean.
