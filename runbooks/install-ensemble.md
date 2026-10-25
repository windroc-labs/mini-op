# Install ensemble on the mini

Rules, waiting and answering: `../README.md`. Accounts, keys and the GitHub App: `setup-test-env.md`.

Visible routing and exceptions: `visible-operations.md`. Setup, cleanup and worker steps run in Terminal; never enlarge or move its window. install.sh prints progress on stderr and reads prompts from fd 3, its tty; `gh auth login` and `claude setup-token` also write directly to that tty. Redirecting stdout/stderr hides public progress and does not protect those auth phases. Device codes and setup tokens can therefore appear on the mini's screen. Follow the “A Terminal screenshot shows the setup token” bullet in `../README.md` › Gotchas; do not capture them in screenshots. Credentials supplied to the installer stay in private stdin/files; page input uses secfield.

## 6. Then

### OpenCode-only install

Pick `--ref <branch-or-commit>` (default main). Both wrappers fetch from `windroc-labs/ensemble`; install-test also passes that ref to install.sh. clean-test uses it only for the download: upstream cleanup has no --ref. Pin the same ref for install and cleanup.

Supported ref characters: ASCII letters, digits, `_ . / -`; refs cannot start with dot/slash/hyphen, contain `..`, repeated slashes, dot-leading components or `.lock` components, or end with slash/dot. The CLI rejects traversal and URL metacharacters before any download.

Pass decisions before starting: `--clients opencode`, `--board local` (or the chosen Linear board), `--no-docker`, `--no-launchd`, `--opencode-provider/url/model/context` (`OC=1` supplies the existing Strata settings), `--password-stdin`, and `--opencode-key-stdin`. Prepare a private input file by protected stdin/keychain pipes: account password on the first line, Strata key on the second. Never pipe the downloaded script through that credential stdin. Remove the input after the installer ends.

```sh
printf '%s\n' 'umask 077; OC=1 ~/apm/runbooks/install-ensemble/install-test --ref <branch-or-commit> -- --clients opencode --board local --no-docker --no-launchd --password-stdin --opencode-key-stdin < ~/apm/state/install.input' | mini run 30
```

Observed prompt order from the user's WDRC-99 report; existing state can skip a row. A 75 means inspect, never blindly send the next answer. Use `mini run 30 --to <id>` only for the confirmed prompt. Read the redacted Terminal tail with termtail or termwait.

| Order | Prompt/stage | Answer or upfront choice |
| --- | --- | --- |
| 1 | sudo password | `--password-stdin` consumes the first private stdin line; otherwise confirmed no-echo prompt → mini pw |
| 2 | Write `.zprofile` | y |
| 3 | Write ensemble config | y; `--board` decides the board type |
| 4 | gh “Authenticate Git”, then Enter to open device login | Y, then Enter; gh prints the device code to the tty; use the existing Chrome tab, each code character through masked secfield; GitHub sudo mode uses keychain → secfield → Confirm, then real-focus Authorize |
| 5 | Plugin write/install | y |
| 6 | Provider config write | y; set `--opencode-provider`, `--opencode-url`, `--opencode-model`, `--opencode-context` first |
| 7 | `opencode auth login` | without `--opencode-key-stdin`: Other → strata → key by protected stdin at a confirmed hidden prompt; with it, consume the second private stdin line |
| 8 | First PATH write | y |
| 9 | Second PATH write | y |

Flags verified against [install.sh](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/scripts/install.sh) and [cleanup](https://github.com/windroc-labs/ensemble/blob/1fc016e7f878ab197b6f73902795c9ab935b057c/scripts/install-cleanup.sh). Non-main installer refs currently require OpenCode-only clients. Keep browser login visible where it contains no secrets; gh device codes and Claude setup tokens print to the tty as described above.

### Other test sequences

1. Put the ids and keychain names into the mini's `~/.ensemble/config.local.toml` (docs/credentials.md › Linear presets).
2. Install script tests (TASK-812), in the mini's real Terminal; progress and auth phases print to the tty as above:
   1. Trim the Dock to Terminal, Chrome, iTerm and System Settings (`defaults write com.apple.dock persistent-apps …`, `killall Dock`).
   2. Pipe the Strata key (`strata-api-key` / `strata`) from this Mac into the mini's keychain; the Terminal runs in the logged-in session, whose keychain is unlocked.
   3. In the existing Terminal, start it: `printf '%s\n' 'umask 077; ~/apm/runbooks/install-ensemble/install-test' | mini run 30`. Pass `CLIENTS`, `OC` and flags as the chosen test needs; the script defaults to main and sudo is answered at its prompt (`mini pw` only after confirming no echo). Auth phases write to the tty even when stdout/stderr is redirected.
   4. How waiting works: `../README.md` › Waiting and answering.
   5. Answer at once when a wait times out at a prompt (`../README.md` › Waiting and answering). install.sh's prompts:
      - Docker Desktop first run: unattended since main `227d83c` (install.sh accepts the license; no Rosetta prompt, 2026-10-23). Only if a dialog shows: Rosetta prompt (process `com.apple.Virtualization.LinuxRosetta`) › Not Now, then Disable Rosetta (decided: no Rosetta); Subscription Agreement › Accept; Welcome › Skip; check `docker info`, then Enter in the Terminal.
      - `gh` logs in as `dotpm2026`:

        ```mermaid
        flowchart LR
          A[Terminal Enter] --> B[Continue and code]
          B --> C[Focus and Authorize github]
          C --> D{sudo mode?}
          D -->|yes| E[Password and Confirm]
          D -->|no| F[Close extra gh tabs]
          E --> F
        ```

        At `Press Enter to open https://github.com/login/device in your browser...`, let `gh` open Chrome itself. Bind to the existing tab with `o bin --session <name>` (e.g. `gh`); do not use `o open` to make another window. Continue picks the account; feed each code character through secfield into its masked box (`#user-code-0..3`, `#user-code-5..8`; one paste fills only the first box), never through argv or ordinary keystrokes. After Continue, Authorize github needs real page focus: real-click blank space until `document.hasFocus()` is true, move the real pointer onto the button, wait about 1 s, then real-click. For sudo mode (`#sudo_password`), unlock the mini's keychain in the same ssh session (`../README.md` › Gotchas), then `source ~/apm/lib/keychain.zsh; keychain_read agentpm-test-github | ~/apm/bin/secfield <session> '#sudo_password'`; real-click Confirm. Close any extra tabs `gh` opened when done.
      - The user does the Claude browser login. install.sh runs `claude setup-token` and the broker login on fd 3, so the setup token prints to the tty. The user supplies the token at the broker prompt. Before any screenshot, clear scrollback (Cmd+K); for a keychain dialog use the fixed positions in the Gotchas section of `../README.md`, without a screenshot.
      - broker GitHub: the App's pem path and ID (`setup-test-env.md` 3b.3); a fresh install asks nothing more (2026-10-23). An upgrade may still ask the login password and raise the keychain dialog (6.2.11).
      - broker OpenCode: at `opencode auth login` type `Other`, then `strata`; at the hidden key prompt, unlock the keychain in the same ssh session, then `source ~/apm/lib/keychain.zsh; keychain_read strata-api-key strata | ~/apm/bin/ans 30 --to <id>` (the key stays on the mini).
   6. A rerun from the same Terminal: `eval "$(/opt/homebrew/bin/brew shellenv)"` first (the shell predates the `.zprofile` line); finished steps print `skip`.
   7. Send each install.sh defect to the TASK-812 engineer as it shows up.
   8. Cleanup: `clean-ensemble.md`.
   9. OpenCode worker check, from the mini's Terminal (an ssh shell's keychain is locked): `cd ~/.ensemble/adhoc/oc-test && ensemble-crew run --manager mini-test oc-test -- ensemble-session start oc-test --client opencode --display none --prompt "Reply with exactly: ok from opencode"`. The first run builds the worker image (~80 s) and macOS asks to let Docker reach the local network: Allow. Show it to the user in a Terminal window with the printed attach command, its `-t '=oc-test'` quoted.
   10. Runs: fresh install, rerun (all skipped), cleanup, fresh install; then an OpenCode worker answers through Strata.
   11. Upgrade in place (2026-10-21, 40c06c4 → 664ca15, OpenCode-only + Docker + local board): rerun with the first run's choices, `CLIENTS=opencode OC=1 ~/apm/runbooks/install-ensemble/install-test -- --docker --board local`, in the existing Terminal via `mini run`; auth phases print to the tty as above. Pass `--board` again: the saved choice (`~/.ensemble/install/state` `board_tracker`) wins over `config.local.toml`. It keeps the config, the board and an unloaded router job (a plist already in place is skipped, never bootstrapped). It refreshes OpenCode's ensemble copy (the `~/.ensemble/bin` commands run it) and, when the broker sources changed, rebuilds the broker (`mini pw` at sudo) and asks its logins again: `login github ensemble-bot` asks the login password on the Terminal (`mini pw`); a SecurityAgent change-access dialog **may or may not appear**. It appeared during this in-place upgrade on 2026-10-21 and the next on 2026-10-22, but not during another fresh login on 2026-10-21. If it appears, the user types the login password into it and clicks Allow (mini-op: `mini pw --sa` does both); if not, continue when the Terminal reports success, without waiting for or trying to summon a dialog. `login opencode strata` asks the Strata key at a hidden prompt; the user pastes it. Auto mode blocks the manager from typing a secret anywhere but `mini pw`'s Terminal route. A hidden prompt's line does not change after the answer, so wait for the next step's line (`API key saved`, `==> ctmux`), not for the prompt to go away. The first role run afterwards rebuilds the worker image (~35 s).
       Upgrade to ef0dd8813 (2026-10-22, `CLIENTS=opencode OC=1 ~/apm/runbooks/install-ensemble/install-test -- --docker --board local --no-launchd`), differences: `==> OpenCode provider` asks `install.sh will write to ~/.config/opencode/opencode.jsonc: provider: strata (URL, model, context; credentials stay in auth.json) Write it? [y/N]` (default N): y; the config before it is kept at `~/apm-tests/opencode.jsonc.before-847`. No Strata key prompt: it prints `skip: strata in …/auth.json`. The plugin step finds OpenCode's copy at another commit and downloads it again (about as long as the first time). The next upgrade, past TASK-858 (PR #591), asks to add `~/.ensemble/opencode/bin` to the shell profile: y. Past TASK-862 (PR #592, broker protocol 19) the broker must be reinstalled.
