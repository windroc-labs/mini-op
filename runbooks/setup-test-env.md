---
when: setting up the mini's machine access and browser, or reconnecting mini-op to a reset mini
---

# Set up the test environment

How the manager makes a blank macOS machine into the Mac mini mini-op drives: machine access and the browser. The mini's scripts are in `mini/` of this checkout, installed there as `~/apm/` by `ctl/mini sync` (`host/README.md`, Deploy to the mini). A project's own accounts and keys are in that project's runbooks (for ensemble: `.mini-op/runbooks/` in `windroc-labs/ensemble`).

Rules, driving the mini and gotchas: `../README.md`. What exists now: `../status.md`.

Visible routes and protected exceptions: `visible-operations.md`. Run public mini commands in `mini exec` (interactive: `mini run`); ordinary browser steps stay foreground. Credential pipes and authentication mail stay private before their first secret appears; page input only through secfield. A private page that cannot render safely is a failed step, not a reason to show it.

## 1. Machine access

1. The user enables Remote Login; add this Mac's key to the mini's `~/.ssh/authorized_keys`; check the host key fingerprint.
2. Give `sshd-keygen-wrapper` Screen Recording, Accessibility, Full Disk Access and Automation for System Events (the user approves each prompt).
3. On the mini, with the mini's password on stdin (from mini-op: `< /run/secrets/mini-password`; before mini-op is set up, the user types it at the mini's prompt): auto-login (from mini-op: `mini-autologin`, which also restores a lost one), `pmset sleep 0`, `autorestart 1`, `pmset displaysleep 60`, `sysadminctl -screenLock 3600 -password -`, screen saver off (`defaults -currentHost write com.apple.screensaver idleTime -int 0`).
4. Screen Sharing (VNC) for the user to watch: turn it on in System Settings › General › Sharing › Screen Sharing (`open x-apple.systempreferences:com.apple.Sharing-Settings.extension`, click the switch; Remote Management off). Starting `com.apple.screensharing` with launchctl or `kickstart` opens port 5900 but the viewer says "Screen Sharing is not permitted" (https://github.com/basnijholt/dotfiles/pull/107). Turning Remote Management off asks for the login password in a sheet that `dialogs` does not list: screenshot, click the field, type it piped, Modify Settings. The user connects with `open vnc://<user>@<address>` (both: `../status.md` › Current environment (built 2026-10-20), row Machine), ticking "Remember this password in my keychain" once.

## 2. Browser

1. Chrome from Google's dmg (`codesign` team `EQHXZ8M8AV`); Node LTS from nodejs.org's signed pkg (check SHASUMS256).
2. `npm config set prefix ~/.npm-global; npm install -g @jackwener/opencli`; add the OpenCLI extension from the Chrome Web Store; `opencli doctor` shows daemon and extension connected.
3. For mail-link follow, the user enables Chrome View › Developer › Allow JavaScript from Apple Events. `chrome.js auth` uses the existing Chrome and macOS JXA, no new software; permission errors are safe failures. `linearlogin --code` uses secfield instead.

## Reconnect mini-op after a reset

After the mini is erased and set up again. Its address and account are `mini_host` and `mini_user` in `~/.mini-op/config.local.yaml` on this Mac, the one place code reads them from: a new Mac fills that file first (`../host/README.md`, Steps), and another address or account changes only that file. The steps are in order: the user's at the mini, the user's on this Mac, then mini-op's.

At the mini (the user):

1. Erase All Content and Settings (`return-mini.md`). In Setup Assistant create the admin account `<mini_user>` (or another name, then set `mini_user` to it in step 4) with the same password as the account before, signed into no Apple Account.
2. System Settings › General › Sharing: Remote Login on, Screen Sharing on (Remote Management off). Privacy & Security › FileVault off: auto-login needs it off.
3. In Terminal, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`: note the new host key's SHA256 fingerprint for step 5.

On this Mac (the user, in this checkout):

4. If the account or address changed, set `mini_user` or `mini_host` in `~/.mini-op/config.local.yaml` and run `host/config`.
5. Pin the mini's new host key in mini-op's own state:

   ```sh
   host/pin-host-key
   ```

   It scans only the configured address and port and shows the Ed25519 SHA256 fingerprint. Type `yes` only when it matches step 3. This replaces `~/.mini-op/known_hosts`; cancellation or failure keeps the old pin. Leave this Mac's `~/.ssh/known_hosts` alone. `host/start` never scans or re-trusts a changed key.

6. Add mini-op's public key to the account's `~/.ssh/authorized_keys` with `host/README.md` step 2 (the existing container still has that public key). That command verifies the mini against the pin from step 5 and may ask for the account's password. For ensemble's environment key instead, repeat Environment definition's public-key authorization with the existing environment key. Then `host/stop` and `host/start`: the rebuilt image carries the new pin, `ctl/` and ssh config (redo `host/README.md` steps 4–5). SSH keeps refusing a changed key until this explicit confirmation and rebuild.

In mini-op:

7. `mini sync`, then `mini sync --check`.
8. Section 1, steps 2–4: the permissions, `mini-autologin` and the settings, Screen Sharing.
9. Ask the user to update `../status.md` (row Machine: the account, the host name, the date).
