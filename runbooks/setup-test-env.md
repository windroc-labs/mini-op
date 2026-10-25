# Set up the test environment

How the manager builds the live-test environment on the Mac mini: a blank macOS machine, its own email, its own Linear workspace with role accounts, and their keys in the mini's keychain. This folder (`~/playground/mini-op/`) holds it all: the mini's scripts in `mini/` (installed there as `~/apm/` by `ctl/mini sync`: `host/README.md`, Deploy to the mini), the board's config ids in `runbooks/test-board.toml`.

Rules, driving the mini and gotchas: `../README.md`. What exists now: `../status.md`.

## 1. Machine access

1. The user enables Remote Login; add this Mac's key to the mini's `~/.ssh/authorized_keys`; check the host key fingerprint.
2. Give `sshd-keygen-wrapper` Screen Recording, Accessibility, Full Disk Access and Automation for System Events (the user approves each prompt).
3. On the mini, with the mini's password on stdin (from mini-op: `< /run/secrets/mini-password`; before mini-op is set up, the user types it at the mini's prompt): auto-login (from mini-op: `mini-autologin`, which also restores a lost one), `pmset sleep 0`, `autorestart 1`, `pmset displaysleep 60`, `sysadminctl -screenLock 3600 -password -`, screen saver off (`defaults -currentHost write com.apple.screensaver idleTime -int 0`).
4. Screen Sharing (VNC) for the user to watch: turn it on in System Settings › General › Sharing › Screen Sharing (`open x-apple.systempreferences:com.apple.Sharing-Settings.extension`, click the switch; Remote Management off). Starting `com.apple.screensharing` with launchctl or `kickstart` opens port 5900 but the viewer says "Screen Sharing is not permitted" (https://github.com/basnijholt/dotfiles/pull/107). Turning Remote Management off asks for the login password in a sheet that `dialogs` does not list: screenshot, click the field, type it piped, Modify Settings. The user connects with `open vnc://<user>@<address>` (both: `../status.md` › Current environment (built 2026-10-20), row Machine), ticking "Remember this password in my keychain" once.

## 2. Browser

1. Chrome from Google's dmg (`codesign` team `EQHXZ8M8AV`); Node LTS from nodejs.org's signed pkg (check SHASUMS256).
2. `npm config set prefix ~/.npm-global; npm install -g @jackwener/opencli`; add the OpenCLI extension from the Chrome Web Store; `opencli doctor` shows daemon and extension connected.

## 3. Email (Outlook)

1. On the mini, generate the password into its keychain (`openssl rand` + `security -i add-generic-password`).
2. Plain Chrome window, OpenCLI unbound, keystrokes only: `signup.live.com`, a short address (`dotpm2026`), password typed from the mini keychain, birth date over 18, a name, marketing unticked.
3. The user passes the press-and-hold check.
4. At "Help protect your account", open `outlook.live.com/mail/` directly. Its "Keep access … recovery method" dialog: Not now. To stop it for good, add a recovery code (account.microsoft.com/security › Advanced security options) into the mini keychain.

## 3b. GitHub account

Do this before the install test: `install.sh` logs `gh` in.

The account `dotpm2026` and its App `agentpm-test-bot` are the manager's to manage, deletions included, e.g. an App private key no longer used (the user, 2026-10-23).

Pre-rename names: the test resources made before the ensemble rename keep their names, since renaming them changes their URLs and ids: the GitHub App `agentpm-test-bot`, the repo `dotpm2026/agentpm-test`, the Linear workspace Agent PM Test (`linear.app/agentpm-test`, team Agent PM Test) and its project `agentpm-test`. Every `agentpm`/`Agent PM` name in this repo is one of them or says why it stays.

1. Proton (`account.proton.me/mail/signup?plan=free`), plain window: username, password generated into the mini keychain, decline the upsell, Human Verification › Email tab › the Outlook address, code from the Outlook mail; Show the recovery phrase, select and copy it into the mini keychain, tick and Continue.
2. GitHub (`github.com/signup`) with OpenCLI: email `dotpm2026@proton.me`, password typed from the keychain, username; Create account; the 8-digit launch code comes in the Proton mail (inside its message iframe: read it with `eval` over `iframe.contentDocument`); then sign in.

3. GitHub App for the broker (manifest flow, all on the mini as `dotpm2026`):
   1. `gh repo create dotpm2026/agentpm-test --private --add-readme` (keychain unlocked first).
   2. On any github.com page, `o eval` a form POST to `https://github.com/settings/apps/new` with field `manifest` = JSON: name `agentpm-test-bot`, `hook_attributes.active: false`, `redirect_url` `https://example.com/agentpm-manifest`, `public: false`, permissions contents and pull_requests write, checks, actions and metadata read. Click "Create GitHub App for dotpm2026".
   3. Read `code` from the redirected URL; `gh api -X POST app-manifests/<code>/conversions` returns the App ID and `pem`: write the pem to `/tmp/apm-app.pem` (umask 077) with no output.
      For an existing App, get a new private key at Credentials › Key pairs (delete the older key there once the broker holds the new one) (`https://github.com/settings/apps/agentpm-test-bot/key_pairs`) › New key. Chrome downloads it into `~/Downloads`. Terminal has no Downloads permission: in an ssh session, run `umask 077; mv ~/Downloads/<downloaded-key>.pem /tmp/apm-app.pem; chmod 600 /tmp/apm-app.pem`, using the downloaded filename; never print its contents. Import it at the broker prompt (5. below; `install-ensemble.md` 6.2.5), then delete `/tmp/apm-app.pem`.
   4. `https://github.com/apps/agentpm-test-bot/installations/new`: Only select repositories › agentpm-test › Install.
   5. At install.sh's broker prompt give `/tmp/apm-app.pem` and the App ID; type the login password at the prompt. If the keychain change-access dialog appears, have the user enter it there too and click Allow; otherwise continue on Terminal success (`install-ensemble.md` 6.2.11). Delete the pem after.
   Current App: `agentpm-test-bot`, ID 5405554, installation 173613978 on `dotpm2026/agentpm-test`.

## 4. Linear workspace

1. `linear.app/signup` › Continue with email › the address; `~/apm/runbooks/setup-test-env/maillink mark|follow <email>` around the request opens the emailed link.
2. Create the workspace (name and URL by keystrokes), skip the onboarding steps, turn off onboarding emails.
3. Create the manager's key as in "API keys" below; store it as `ensemble-test-linear-key` / `ensemble-test`.
4. Through `~/apm/runbooks/setup-test-env/lq` (body files built on this Mac, scp'd to `/tmp`): states In Review and Handoff (type `started`); label groups `Agent` (Claude, Codex, OpenCode) and `Tasks` (Build, Light Build, Light Research, Deep Research); trash the onboarding issues. Record every id in the config snippet.

Board extras, with `lq` (manager key): project `agentpm-test` (`projectCreate`, team AGE), mapped in `[orchestrator.linear.project_repos]` to `dotpm2026/agentpm-test`; view **Dashboard**, a copy of the real workspace's: `customViewCreate` (name Dashboard, team AGE, shared, filter team key AGE), then `viewPreferencesCreate` (type organization, viewType customView, preferences layout board, issueGrouping workflowState, issueSubGrouping project): columns by status, rows by project.

## 5. Role accounts

1. Invite `dotpm2026+<role>@outlook.com` for harness, researcher, pm, engineer: `organizationInviteCreate(role: admin, teamIds: [team])`. The free plan invites admins only.
2. Per role, one at a time: `ssh mini '~/apm/runbooks/setup-test-env/linearlogin <email>'` in the background (logs out, requests the link, follows it, prints where it lands). Then by hand with OpenCLI: Join, the onboarding steps (profile name `Agent <role>`, Skip, Finish), then the key.

## API keys

Minimum permissions, from `docs/credentials.md`; team access only `Agent PM Test`:

| Account | Permissions |
|---|---|
| manager, harness | Read, Write (Linear then forces Create issues and Create comments on) |
| researcher, pm, engineer | Read, Write (the same: Linear does not allow Write without Create issues) |

1. Settings › Security & access › Personal API keys: revoke any older key of the account.
2. New API key: name `ensemble-<account>`, Only select permissions… (check `#scope-read`, `#scope-write`), Only select teams… › Agent PM Test, Create, Copy to clipboard.
3. From mini-op, `ssh mini '~/apm/runbooks/setup-test-env/storekey <service> <account>' < /run/secrets/mini-password` stores it, clears the clipboard and prints `viewer`.

## Reconnect mini-op after a reset

After the mini is erased and set up again. Its address and account are `mini_host` and `mini_user` in `~/.mini-op/config.local.yaml` on this Mac, the one place code reads them from: a new Mac fills that file first (`../host/README.md`, Steps), and another address or account changes only that file. The steps are in order: the user's at the mini, the user's on this Mac, then mini-op's.

At the mini (the user):

1. Erase All Content and Settings (`return-mini.md`). In Setup Assistant create the admin account `<mini_user>` (or another name, then set `mini_user` to it in step 4) with the same password as the account before, signed into no Apple Account.
2. System Settings › General › Sharing: Remote Login on, Screen Sharing on (Remote Management off). Privacy & Security › FileVault off: auto-login needs it off.
3. In Terminal, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`: note the new host key's fingerprint for steps 5 and 6.

On this Mac (the user, in this checkout):

4. If the account or address changed, set `mini_user` or `mini_host` in `~/.mini-op/config.local.yaml` and run `~/playground/mini-op/host/config`.
5. Drop the mini's old host key on this Mac only (the container trusts just the key `host/start` bakes in):

   ```sh
   address=$(ssh -G -F ~/.mini-op/ssh_config mini | awk '$1 == "hostname" {print $2}')
   ssh-keygen -R "$address" -f ~/.ssh/known_hosts
   ```

6. Add mini-op's key to the account's `~/.ssh/authorized_keys` with the command of `host/README.md` step 2: ssh asks to accept the new host key (only when its fingerprint equals step 3's) and for the account's password. Then `~/playground/mini-op/host/stop` and `~/playground/mini-op/host/start`: the rebuilt image carries the new host key, `ctl/` and ssh config (redo `host/README.md` steps 4–5).

In mini-op:

7. `mini sync`, then `mini sync --check`.
8. Section 1, steps 2–4: the permissions, `mini-autologin` and the settings, Screen Sharing.
9. The 12 keychain items, from the export of the old login keychain (`/home/agent/keychain-backup/export-2026-10-24.keychain-db`, unlocked by the same password). Copy it into a new private dir on the mini and list its items (attributes only, never `dump-keychain -d`):

    ```sh
    d=$(ssh mini 'mktemp -d') && ssh mini "cat > $d/export.keychain-db" < /home/agent/keychain-backup/export-2026-10-24.keychain-db
    ssh mini "security dump-keychain $d/export.keychain-db" | grep -E 'class:|"(svce|acct)"<blob>='
    ```

    Import each generic password (class `genp`) by its service (`svce`) and account (`acct`). Each name must match `^[A-Za-z0-9][A-Za-z0-9._@+:-]*$`, else stop and ask the user; 12 are expected, any other count: tell the user which and ask before importing. The export predates the ensemble rename: import a service `agentpm-test-<x>` as `ensemble-test-<x>` and the account `agent-pm-test` as `ensemble-test` (the new names, after the old ones); keep other names.

    ```sh
    ssh mini "~/apm/runbooks/setup-test-env/importkey $d/export.keychain-db <service> <account> [<new-service> [<new-account>]]" < /run/secrets/mini-password
    ```

    It prints `importkey: <service>/<account> imported`, or `… imported as <new-service>/<new-account>`. An internet password (class `inet`, e.g. git's `github.com`) is not imported: the `gh` login (step 10) makes it again. Then remove the copy: `ssh mini "rm -rf $d"`.
10. `gh`: once installed (`install.sh` logs it in: `install-ensemble.md`), log in again as `dotpm2026` (password: keychain `ensemble-test-github`).
11. Ask the user to update `../status.md` (row Machine: the account, the host name, the date).
