# Status

One-off records: what exists now and where the work stopped. Procedures: `README.md` and `runbooks/`.

## Current environment (built 2026-10-20)

| Item | Value |
|---|---|
| Machine | `dot@192.168.1.200` (`Dots-Mac-mini.local`), M4, macOS 26.7.1; `dot` (auto-login, admin) signed into no Apple Account |
| Owner admin | a second local admin (2026-10-24), the user's only: its password differs from dot's and is never given to mini-op or the manager; signed into the user's Apple Account with only Find My Mac and the Find My network on (all iCloud sync off), so Activation Lock and remote erase stay with the user. mini-op's key is not authorized for it |
| Email | `dotpm2026@outlook.com`, no recovery method; password: mini keychain `ensemble-test-outlook` / `outlook` |
| Linear workspace | https://linear.app/agentpm-test (Agent PM Test, free plan; pre-rename names: `runbooks/setup-test-env.md` 3b), team `AGE` `dd277963-4a78-4565-8902-0faa9b604bab` |
| Manager account | Dot Tester, `dotpm2026@outlook.com`, owner; key: mini keychain `ensemble-test-linear-key` / `ensemble-test` |
| Proton mail | `dotpm2026@proton.me` (for GitHub, which refuses Outlook); password: mini keychain `ensemble-test-proton`, recovery phrase `ensemble-test-proton-recovery` |
| GitHub | user `dotpm2026`, email `dotpm2026@proton.me`; password: mini keychain `ensemble-test-github`; `gh` uninstalled from the mini 2026-10-24 (its keychain items `gh:github.com` and `~/.config/gh` kept; git's `github.com` internet password for `dotpm2026` kept) |
| Docker | user `dotpm2026`, email `dotpm2026@outlook.com`, Personal (free); password: mini keychain `ensemble-test-docker` / `dotpm2026@outlook.com`. Docker Desktop and Docker Sandboxes `sbx` uninstalled from the mini 2026-10-24 (`~/.docker`, `~/.sbx`, `com.docker.sandboxes` and the `sandboxes-auth` keychain items removed); the `docker/tap` tap remains; reinstall sbx with `brew trust docker/tap; brew install docker/tap/sbx` |
| Role accounts | `dotpm2026+<role>@outlook.com` for harness, researcher, pm, engineer, all admins; keys: mini keychain `ensemble-test-linear-<role>` / the address |
| Strata | the OpenCode provider on the LAN (`runbooks/manager-on-mini.md`); key: mini keychain `strata-api-key` / `strata` |
| Config ids | `runbooks/test-board.toml`; copy into the mini's `~/.ensemble/config.local.toml` |

## Status (2026-10-20, end of day)

- Mini: erased and reset 2026-10-24 (the user); one admin account `grit` (same password as the old `dot`), auto-login grit, Screen Sharing on (administrators), Energy: no sleep with display off, wake for network access, start up on power. Not yet reconnected to mini-op, no keychain items imported, nothing else installed. Credentials from the old `dot` keychain: 12 items exported to the container's `/home/op/keychain-backup/export-2026-10-24.keychain-db` (dot's password), read back from a copy before the erase. Baseline: Time Machine (encrypted, manual only) to `diskstation1522` share `TimeMachineBackup` as DSM user `mac-mini-grit` (SMB only; root of the share: list and create only, each Mac owns its own bundle via an Owner ACL; mini quota 1.28 TB), first backup 2026-10-24 12:15 (mini clock); locked DSM snapshot `GMT-05-2026.10.24-14.18.58`, "mini grit baseline 2026-10-24".
- Claude: both test credentials revoked by the user; the next install needs the user's Claude login again (Claude Code login and `setup-token`).
- Linear keys: all minimum scope (Read + Write, which forces Create issues and Create comments; team Agent PM Test only). Manager (`agent-pm-manager`), harness, researcher and pm (`agent-pm-<role>`; key names from before the ensemble rename) recreated and their Full-access keys revoked 2026-10-24; engineer's was already minimum scope. Outlook's Focused Inbox is off (2026-10-24) and `linear.app` is a safe sender (2026-10-25); `maillink` reads the Inbox and Junk Email.
- GitHub: account `dotpm2026`, App `agentpm-test-bot` (ID 5405554) installed on `dotpm2026/agentpm-test`; its pem was deleted after the broker login: generate a new private key in the App settings for the next install.
- install.sh (PR #547): Fixed and pushed: 1-6, docs for the App. Pending with the TASK-812 engineer (session `engineer-TASK-812-858886a9`, told to fix directly, push without waiting for CI): Docker first run unattended with Rosetta off and a build-match check; bot user looked up by the fixed name `ensemble-bot`; cleanup failing on Docker's container dir and leaving "Claude Code-credentials" and Docker's `.zprofile` block.
- Next: once those land, run `runbooks/install-ensemble.md` 6.2 end to end (fresh install, rerun all-skip, cleanup, fresh install), then an OpenCode worker answers through Strata; then the TASK-814 OpenCode-only install (`--clients opencode`, after install.sh accepts it).
