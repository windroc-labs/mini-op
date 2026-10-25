# Status

One-off records: what exists now and where the work stopped. Procedures: `README.md` and `runbooks/`.

## Current environment (user report, 2026-10-25)

The account, OS and keychain service names below are the user's WDRC-156/WDRC-99 report; this PR made no live checks. Address and SSH account configuration: `~/.mini-op/config.local.yaml`. Exported keychain accounts stay unchanged; services keep their existing `agentpm-test-*` names.

| Item | Value |
|---|---|
| Machine | `grit` (auto-login, admin), M4, macOS 27.0.1; signed into no Apple Account at reset |
| Email | `dotpm2026@outlook.com`, no recovery method; password: mini keychain `agentpm-test-outlook` / `outlook` |
| Linear workspace | https://linear.app/agentpm-test (Agent PM Test, free plan; pre-rename names: `runbooks/setup-test-env.md` 3b), team `AGE` `dd277963-4a78-4565-8902-0faa9b604bab` |
| Manager account | Dot Tester, `dotpm2026@outlook.com`, owner; key: mini keychain `agentpm-test-linear-key` (lookup by service; preserve exported account) |
| Proton mail | `dotpm2026@proton.me` (for GitHub, which refuses Outlook); password: mini keychain `agentpm-test-proton`, recovery phrase `agentpm-test-proton-recovery` |
| GitHub | user `dotpm2026`, email `dotpm2026@proton.me`; password: mini keychain `agentpm-test-github`; git internet-password item `github.com` for `dotpm2026` |
| Docker | user `dotpm2026`, email `dotpm2026@outlook.com`, Personal (free); password: mini keychain `agentpm-test-docker` / `dotpm2026@outlook.com`; installed app state not inspected by this PR |
| Role accounts | `dotpm2026+<role>@outlook.com` for harness, researcher, pm, engineer, all admins; keys: mini keychain `agentpm-test-linear-<role>` / the address |
| Strata | the OpenCode provider on the LAN (`runbooks/manager-on-mini.md`); key: mini keychain `strata-api-key` / `strata` |
| Config ids | `runbooks/test-board.toml`; copy into the mini's `~/.ensemble/config.local.toml` |

## Status (2026-10-25)

- WDRC-99 live test is running. Do not touch the mini, or stop/remove/restart `mini-op`, `mini-op-proxy` or `mini-op-net`. This engineer uses repo fakes and CI only.
- The user observed about 25 of 32 minutes spent waiting at installer prompts. WDRC-156 adds a 75 idle/look-now signal, read-only termtail and 30-second interactive waits; only exit markers prove completion. Install/ref/prompt procedure: `runbooks/install-ensemble.md`; OpenCode board tmux config: `runbooks/manager-on-mini.md`. These changes are not deployed by this run.

## Earlier records

- Mini: erased and reset 2026-10-24 (the user); one admin account `grit` (same password as the old `dot`), auto-login grit, Screen Sharing on (administrators), Energy: no sleep with display off, wake for network access, start up on power. Credentials from the old `dot` keychain: 12 items exported to the container's `/home/op/keychain-backup/export-2026-10-24.keychain-db` (dot's password), read back from a copy before the erase. Baseline: Time Machine (encrypted, manual only) to `diskstation1522` share `TimeMachineBackup` as DSM user `mac-mini-grit` (SMB only; root of the share: list and create only, each Mac owns its own bundle via an Owner ACL; mini quota 1.28 TB), first backup 2026-10-24 12:15 (mini clock); locked DSM snapshot `GMT-05-2026.10.24-14.18.58`, "mini grit baseline 2026-10-24".
- Claude: both test credentials revoked by the user; the next install needs the user's Claude login again (Claude Code login and `setup-token`).
- Linear keys: all minimum scope (Read + Write, which forces Create issues and Create comments; team Agent PM Test only). Manager (`agent-pm-manager`), harness, researcher and pm (`agent-pm-<role>`; key names from before the ensemble rename) recreated and their Full-access keys revoked 2026-10-24; engineer's was already minimum scope. Outlook's Focused Inbox is off (2026-10-24) and `linear.app` is a safe sender (2026-10-25); `maillink` reads the Inbox and Junk Email.
- GitHub: account `dotpm2026`, App `agentpm-test-bot` (ID 5405554) installed on `dotpm2026/agentpm-test`; its pem was deleted after the broker login: generate a new private key in the App settings for the next install.
- install.sh (PR #547): Fixed and pushed: 1-6, docs for the App. Pending with the TASK-812 engineer (session `engineer-TASK-812-858886a9`, told to fix directly, push without waiting for CI): Docker first run unattended with Rosetta off and a build-match check; bot user looked up by the fixed name `ensemble-bot`; cleanup failing on Docker's container dir and leaving "Claude Code-credentials" and Docker's `.zprofile` block.
- Earlier test plan (not a current instruction): fresh install, rerun all-skip, cleanup, fresh install, then an OpenCode worker through Strata; the current WDRC-99 run and `runbooks/install-ensemble.md` supersede that pending plan.
