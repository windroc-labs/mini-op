# mini-op

Docs and scripts that build and drive the live-test environment for
ensemble on a Mac mini.

The environment holds:

- test Outlook, Proton and GitHub accounts
- a test Linear workspace and board
- `install.sh` live tests, run in a real Terminal on the mini
- an OpenCode/Claude manager running on the mini

Private repo. It holds no secrets: passwords, API keys and tokens live in the
mini's login keychain, and the scripts read them from there.

## Start here

Read this README whole before touching anything: rules, driving the mini, gotchas. Then the runbook for
the task. Each fact has one home; the others point to it.

| File | Covers |
| --- | --- |
| `README.md` › Rules, Driving the mini, Gotchas | what you must and must not do; screen, clicks, typing, the browser, waiting and answering; read before debugging |
| `status.md` | one-off records: the current environment and where the work stopped |
| `runbooks/setup-test-env.md` | machine access, browser install, Outlook, GitHub, the Linear workspace, role accounts, API keys |
| `runbooks/install-ensemble.md` | `install.sh` live tests (`install-test`), reruns and upgrades in place |
| `runbooks/clean-ensemble.md` | cleanup (`clean-test`) and the post-test check of the mini's login and launch items |
| `runbooks/manager-on-mini.md` | the OpenCode/Claude manager on the mini |
| `runbooks/return-mini.md` | erasing the mini before it goes back |
| `host/README.md` | the mini-op container that operates the mini |

## Layout

Files sit by where they run.

| Path | What it is |
| --- | --- |
| `status.md`, `runbooks/` | current records and the procedures (Start here); `runbooks/test-board.toml`: ensemble board settings for the test Linear workspace, for the mini's `~/.ensemble/config.local.toml` |
| `mini/` | runs on the mini, copied there as `~/apm/` by `ctl/mini sync` (`host/README.md`, Deploy to the mini), which keeps the mini's runtime state in `~/apm/state/`: `bin/` basic operations, `ts/` the JXA programs' TypeScript and `ts/page/` the page programs' (the code `o eval` runs in a page), `js/` and `js/page/` the programs `tsc` builds from them (committed, never edited by hand), `lib/chord.applescript` the one AppleScript program (held-modifier chords), `lib/secrets.zsh` the one list of secret patterns, `lib/opencli.zsh` the one parser of OpenCLI's replies (`opencli_data`) and the page-program caller (`page_js`), `lib/keychain.zsh` the one keychain reader (`keychain_read`, `keychain_has`; runbook steps source it too), `runbooks/<runbook>/` scripts only that runbook uses; on the mini they run as `~/apm/bin/<name>` and `~/apm/runbooks/<runbook>/<name>` |
| `ctl/` | runs in the mini-op container (baked into the image's plugin root, on its `PATH`) or on this Mac; `ctl/lib/secrets.zsh` names the secrets dir; `ctl/CLAUDE.md` is the container operator's routing table and hard rules |
| `plugin/` | the mini-op plugin, baked into the mini-op image under `/opt/windroc/plugins/mini-op/`: `plugin/.claude-plugin/plugin.json` its manifest, `plugin/skills/run/SKILL.md` its skill `/mini-op:run` |
| `host/` | runs on this Mac: the mini-op container and its proxy, and `config.yaml` (every setting's default; the mini's address and account empty) with `config`, which merges `~/.mini-op/config.local.yaml` onto it and generates the ssh and proxy configs into `~/.mini-op/` (`host/README.md`) |
| `tests/`, `.github/`, `.githooks/` | offline tests, CI and the optional pre-commit hook (Offline checks) |

### Scripts

| Script | What it does |
| --- | --- |
| `mini/runbooks/install-ensemble/install-test [-- <install.sh flags>]` | runs PR #547's `install.sh` as a user would, in the Terminal, sudo password typed at its prompt by mini-op's `mini pw`; `OC=1` adds the Strata OpenCode flags from `mini/runbooks/install-ensemble/strata.conf` |
| `mini/runbooks/clean-ensemble/clean-test [-- <install-cleanup.sh flags>]` | same for PR #547's `install-cleanup.sh` |
| `mini/bin/ans [secs] [--to <id>]` | types stdin into the mini's Terminal plus Enter (a command with an exit-code marker; with `--to`, an answer to command `<id>` as is), scrolls to bottom, then runs `termwait` (Waiting and answering) |
| `mini/bin/termwait <secs> --after <id>` | waits for command `<id>`'s marker file, prints the last 25 lines with tokens redacted and `<id> exited <rc>`; exits 0, 1 or 124 (Waiting and answering) |
| `mini/js/keys.js [--enter] [--front Terminal\|SecurityAgent] [--secret] [--verify-field] [--wake]` | JXA: types stdin as keystrokes, less one trailing newline; `--enter` adds Enter, `--front` types only into that app (SecurityAgent: its one focused secure field), `--verify-field` checks the field got every character and clicks Allow, `--secret` keeps the text out of every message |
| `mini/js/click.js <x> <y>` | JXA: click at screen coordinates |
| `mini/js/terminal.js activate\|front\|history [--all]\|contents\|bottom`, `mini/js/chrome.js activate\|close <url-substring>` | JXA: the Terminal (activate hides Chrome; bottom is Cmd+End) and Chrome operations the scripts use |
| `mini/bin/dialogs [click <button>]` | lists on-screen windows with buttons, or presses the named button (`mini/js/dialogs.js`) |
| `mini/bin/front <url-substring>` | brings the Chrome tab whose URL matches to the front (`mini/js/front.js`); exits 1 when none matches |
| `mini/bin/o` | wrapper for `opencli browser` (browser sessions, e.g. `role`, `mail`) |
| `mini/bin/secfield <session> <css>` | types stdin (a secret) into that page field by keystrokes, only once a real click put the keyboard focus there; prints nothing of it |
| `mini/bin/shot [out.png]` | screenshots the mini, refused while a Terminal window holds a secret (a pattern in `mini/lib/secrets.zsh`) or cannot be read |
| `ctl/mini sync [--check]` | run on this Mac or in mini-op: copy `mini/` to the mini's `~/apm/` with its `VERSION` stamp, keeping `~/apm/state/`; `--check` exits 1 unless the mini's `~/apm/VERSION` matches |
| `ctl/mini run [secs] [--to <id>]` | run on this Mac or in mini-op: types stdin into the mini's Terminal with `~/apm/bin/ans` and waits (Waiting and answering); not for secrets: use mini pw |
| `ctl/mini chord <mods> <key code>` | run on this Mac or in mini-op: a held-modifier chord (`mini/lib/chord.applescript`) into the mini's front Terminal |
| `ctl/mini pw [--lock \| --sa]` | mini-op only: types the mini's password from `/run/secrets/mini-password` (Rules) into the mini's front Terminal, the lock screen (`--lock`) or the SecurityAgent dialog (`--sa`: clicks Allow, only when its one secure field is focused) |
| `ctl/mini sudo <command> [args]`, `ctl/mini sudo -v` | mini-op only: runs a command with sudo on the mini, the password from `/run/secrets/mini-password`; `-v` checks the password only |
| `ctl/mini-autologin [--reboot]` | mini-op only: as root (sudo, the mini's password from `/run/secrets/mini-password` on stdin) re-enables the account's auto-login: writes `/etc/kcpassword` itself (the public XOR encoding, by stock `perl`; mode 600, root:wheel), as `sysadminctl -autologin set` cannot over ssh, and sets `autoLoginUser` to the account; it fails unless the file was rewritten (new inode, mtime and size) and `autoLoginUser` is the account; `--reboot`, only at the login window: then reboots and waits up to 300 s for the account to be the console user (exit 124 if the mini does not come back) |
| `mini/runbooks/setup-test-env/linearlogin <email>` | logs the Linear tab out, requests a login link for the email, follows it |
| `mini/runbooks/setup-test-env/maillink mark\|follow <email>` | remembers the newest Linear login link in Outlook, then opens the new one without printing it |
| `mini/runbooks/setup-test-env/storekey <service> <account>` | stores the Linear API key from the clipboard in the keychain, clears the clipboard, checks it |
| `mini/runbooks/setup-test-env/importkey <keychain> <service> <account> [<new-service> [<new-account>]]` | copies one generic password from an exported keychain (unlocked, like the login keychain, by the password on stdin) into the login keychain, under the new names when given, locks the export again, checks it |
| `mini/runbooks/setup-test-env/lq <json-body-file>` | sends a Linear GraphQL request with the keychain key |

## Rules

- Secrets move only machine to machine by pipe or redirect: `ssh mini '<reads stdin>' < /run/secrets/mini-password`. Never in argv, env, logs or output.
- The mini's address and account are `mini_host` and `mini_user` in `~/.mini-op/config.local.yaml` on this Mac, never in this repo (`host/README.md`, Steps); docs write the account as `<mini_user>`. Its password is only in mini-op's `/run/secrets/mini-password`, which the user types in after every container start (`host/README.md` step 4), or in an ensemble environment's `/run/ensemble/secrets/env/mini-password`, which `ctl/` reads first when it exists. While mini-op is stopped, the user types it at the mini's prompt. Without either file (a fresh container start, or this Mac) `mini pw` and `mini sudo` exit 1 and send nothing: ask the user to write it.
- Run nothing that installs developer tools on the mini: it has no python3, and calling it pops the Command Line Tools installer. Install scripts must start from this blank state.
- The user does every human check (CAPTCHA, press-and-hold). On the mini the no-defeating-bot-detection rule does not apply (the user, 2026-10-21): e.g. human-like timing jitter in typed input is fine.
- Long waits (email delivery) run as background commands on this Mac.
- **Never move or resize a window on the mini** (no Terminal size or font change): the user sizes the VNC window and arranges them (the user, 2026-10-21).
- From the mini-op container, only Claude and the mini's ssh (`ssh`, `scp`) get out (`host/README.md`, Network): fetch anything else on the mini over ssh.
- Scripts do the fixed, mechanical parts (mail lookup, login, key storage); the manager drives the website steps with OpenCLI, reading each page before acting, so a changed page is noticed instead of clicked through.
- Read pages with OpenCLI (`eval`, `state`, `wait`); screenshots only for what is outside a page (lock screen, Chrome or macOS dialogs).

- macOS dialogs (Rosetta, keychain, local network, folder access) are read and clicked with `~/apm/bin/dialogs` (`dialogs` lists each window's buttons; `dialogs click "Don’t Allow"` presses one), not screenshots. A screenshot is the last resort, for a window with no named buttons, and never while a secret is on screen.

## Driving the mini

From this Mac, `ssh mini` and `scp` to `mini:` need `-F ~/.mini-op/ssh_config` (`host/config` generates it); in mini-op they work as written.

Outside a page: `screencapture -x`, scp back, `sips -Z 1440` (image pixels = points on the 880x1440 display); clicks `osascript -l JavaScript ~/apm/js/click.js X Y`; typing `printf … | osascript -l JavaScript ~/apm/js/keys.js --enter` (without `--enter`, no Enter).

### Browser

1. Keep one Chrome window: OpenCLI's own, holding session `role` (Linear) and session `mail` (Outlook, opened with `o open … --session mail`). Close any other window.
2. Drive pages with `~/apm/bin/o <command> --session <name> --window foreground`, after `~/apm/bin/front <url part>` raises the tab; wait with `o wait text|selector …`, not `sleep`.
3. A React field that stays empty after `o type`: click it with `click.js` and type with `keys.js`.

### Waiting and answering

Type a command into the mini's Terminal, from this Mac or mini-op, with `printf '%s\n' '<cmd>' | mini run <secs>` (on the mini: `~/apm/bin/ans <secs>`), never with a wait or answer script of your own: when `mini run` or `termwait` falls short, stop and tell the user what it missed, so the shared script gets fixed.

How waiting works: `ans` types the command wrapped so that, when it ends, it writes its exit code to the marker file `~/apm/state/done/<id>` on the mini; `termwait <secs> --after <id>` (which `ans` runs) checks that file every second, nothing on the screen. It then prints the Terminal's last 25 nonblank lines with tokens hidden and `<id> exited <rc>`, deletes the marker and exits 0 when `<rc>` is 0, else 1. After `<secs>` without the marker it prints the same lines, then `termwait: still running: <id> (after <secs> s); keep waiting with termwait <secs> --after <id>` on stderr, and exits 124: the command is still running, often at a prompt shown in those lines. Keep waiting with `ssh mini '~/apm/bin/termwait <secs> --after <id>'`. Markers over a day old are deleted. The Command Line Tools install prints nothing for minutes ("Installing Command Line Tools for Xcode …"): wait 240 s at a time.

`ans`, and `mini run` through it, exit as `termwait` does, and also 124 when a wait of their own runs out: `ans: timed out after 5 s: typed text did not land; not waiting` when the Terminal's text did not change after typing (nothing to wait for), `ans: killed after <N> s: <step>` when a Terminal call hung before or during that wait (typing 15 s, the others 5 s); when no read of the typed text's landing answered, the 124 line names `<id>` and the hint `termwait <secs> --after <id>`, as the text may have landed (`ans: killed after 5 s: reading Terminal; …` if a read hung, else `ans: timed out after 5 s: cannot read Terminal; …`). A hung scroll after `termwait` only prints `ans: note: killed after 5 s: …`, and `ans` exits with termwait's code. They exit 1 when they refused or failed before waiting (e.g. `ans: Terminal not frontmost; typed nothing`) and 2 on a usage error. `mini run` also exits 1 when ssh fails (`mini: run: ssh to the mini failed`), when the mini has no `~/apm/lib/timeout.zsh` yet (run `mini sync`) and on any other rc from the mini (`mini: run: the mini exited <rc>`).

Answer at once when a wait times out at a prompt: a prompt waits silently, and the user's view of the Terminal may not have scrolled down to it. `printf y | mini run 300 --to <id>` types the answer as is (no marker) plus Enter, scrolls to the bottom (Cmd+End, `key code 119 using command down`), and waits for `<id>` again. A plain `mini run` or `ans` (no `--to`) is only for a new command at the shell prompt: its marker suffix would be typed into the prompt. By hand: `osascript -l JavaScript ~/apm/js/terminal.js activate` (hides Chrome, activates Terminal), then `printf y | osascript -l JavaScript ~/apm/js/keys.js --enter`; a password or key from a keychain the same way, piped; then `termwait <secs> --after <id>`, also when someone else answered.

## Gotchas

- **Microsoft blocks sign-up under OpenCLI.** With Chrome under CDP control, the last step fails with "We ran into a problem"; a plain window with keystrokes passes to the human check.
- **Long Outlook addresses come back "isn't available".** Three random addresses failed; a short one passed at once.
- **The mini's keychain locks in every new ssh session.** Reads fail with `User interaction is not allowed` (rc 36), writes with -25308. Unlock it in the same session before each use: `printf 'unlock-keychain -p "%s" login.keychain\n' "$P" | security -i`.
- **OpenCLI acts only on a visible tab.** Clicks and typing on a covered tab fail with "Native input requires a visible browser page" or `semantic_not_found`; a Linear page in a covered window stays on "Loading…"; Outlook renders no message list in a hidden tab, so a read finds an empty inbox. Keep one window and raise the tab with `~/apm/bin/front` first: with two windows, `front` can raise the wrong window's tab of the same site.
- **Finding the Linear login mail.** `click --text "Login for Linear"` matches every such row, and a lookup right after the request returns the previous, used link (`/auth/error`). `maillink` opens the newest row by its timestamp and waits for a link different from the one marked before the request.
- **Two runs fight over the tabs.** One script at a time. A loop on this Mac must be stopped there first (TaskStop), then the script on the mini (`pkill -f 'apm/.*<script>'`): killing only the mini side lets the loop start the next one.
- **Join must be clicked.** After the login link the workspace picker shows Join; skipping it leaves the invite unaccepted and settings pages bounce to the login form.
- **`linear.app/logout` does not log out.** For a logged-in browser it shows the workspace picker with a "Log out" button; until that is clicked, the login form never appears. `linearlogin` clicks it and checks each page before going on.
- **Linear rate-limits logins.** About a dozen logins and retries within half an hour brought a "Verify you are human" check (the user clicks it, over Screen Sharing: `runbooks/setup-test-env.md` 1.4), then a link that logged in without keeping the session, then `/auth/error` "You're trying to login too fast". Log each account in once, a few minutes apart; after the error, wait 30 minutes.
- **GitHub refuses Outlook addresses.** Since late September 2026 GitHub pauses new sign-ups with Outlook/Hotmail addresses; the form says "Email domain could not be verified" (not a rate limit, not automation). Sign GitHub up with another provider.
- **A stale "install command line developer tools" dialog.** Calling `python3` over ssh before the tools exist opens that dialog and it stays up for hours, even after Homebrew installs the tools. Never call `python3` on a blank mini; if the dialog shows, check `xcode-select -p` and click Cancel.
- **Terminal does not take focus from Chrome.** `tell application "Terminal" to activate` leaves Chrome frontmost, so typed answers land in Chrome. Hide Chrome first.
- **Terminal output is copied back verbatim.** A Terminal read once returned the full Claude setup token, which had to be revoked. Read the Terminal only through `termwait` (hides the token block and every pattern in `mini/lib/secrets.zsh`), and never echo a line that holds a secret.
- **Docker's container dir needs Full Disk Access.** `~/Library/Containers/com.docker.docker` cannot be deleted from Terminal ("Operation not permitted"); ssh can (sshd has Full Disk Access).
- **The Terminal view does not follow the output.** The window stayed scrolled at an old line while `install.sh` waited at `Write it? [y/N]`, so it looked stuck in a progress bar. Trust `termwait`'s text, not the window, and scroll the window to the bottom after each answer.
- **Reading the screen missed completions.** Prompt patterns, exit lines and line-count baselines each missed a case (a repeated prompt, an exit line before the wait, output ending in blank lines before the shell prompt waited out the limit, 2026-10-23), so a wait ends only on the command's marker file (Waiting and answering).
- **A Terminal screenshot shows the setup token.** The broker step prints the Claude setup token on screen; a screenshot taken for the keychain dialog after it captured the whole token. After the token step, clear the scrollback (Cmd+K) before any screenshot, and fill the keychain dialog by its fixed position (password field 512,422, Allow 590,465) without one.
- **`do script ""` presses Enter.** Sending an empty `do script` to the Terminal tab answers whatever prompt is open with an empty line (it emptied the OpenCode key once). Use `ans` for every answer and nothing else.
- **A leftover `linear.app/logout` tab logs every new login out.** `o open https://linear.app/logout` can open a second tab; it stayed on /logout and signed the session out within a second of each login link (Chrome history showed /auth/email, then /logout). `linearlogin` now closes every /logout tab first and navigates its own tab with `location.href`. When a login fails, read the tab list and Chrome history before trying again; never request link after link.
- **OpenCode takes `!` as shell mode.** A message typed into the OpenCode TUI with a `!` in it ran as a shell command (`(eval):1: command not found: Create`). Write messages to an OpenCode manager without `!`.
- **Strata has one slot.** Every OpenCode session on the LAN (this Mac's, the mini's manager, its workers) queues on the same slot; `/ensemble:manage`'s first turn took 4 minutes.
- **OpenCode Zen's free tier is no stand-in for Strata.** It rejects external clients (403 `FreeTierError`) and has no API key.
- **A rejected or killed ssh command keeps running on the mini.** Closing this Mac's ssh does not end the remote shell: on 2026-10-21 a rejected command went on sending `do script` and `get contents` to Terminal while new commands did the same, and Terminal stopped answering Apple Events (no crash or hang report; cause not proven). After a rejection run `pgrep -fl 'zsh -c'` and `pgrep -x osascript` on the mini and kill the leftovers; only one command drives Terminal at a time; wrap Terminal `osascript` calls in `with_timeout 8 osascript …` (after `. ~/apm/lib/timeout.zsh`, from `mini/lib/timeout.zsh`; rc 124: kill osascript, restart Terminal).
- **No `python3` in `~/apm` scripts.** A clean mini has no Command Line Tools: any call to `python3` opens their install dialog (Cancel it). `secfield` parses OpenCLI's JSON with `sed` since 2026-10-23.
- **Never type a secret by OS keystrokes after only an OpenCLI (CDP) click.** A CDP click does not move macOS keyboard focus out of Chrome's address bar: on 2026-10-21 the GitHub password went into the omnibox and out as a Google search, and the account password had to be changed. Type secrets with `~/apm/bin/secfield <session> <css>` (secret on stdin): it real-clicks the field, checks `document.hasFocus()` and the active element, and types nothing otherwise.
- **Screenshots of the mini only through `~/apm/bin/shot`**: it refuses while a Terminal window holds a secret (a pattern in `mini/lib/secrets.zsh`) or cannot be read. install.sh's Claude Code login leaves the full setup-token on screen; a raw `screencapture` there put it in my transcript on 2026-10-21.
- **Broker checks over ssh always fail.** `router --brake`, `router --dry-run` and `ensemble-broker probe-provider` read the provider key from the login keychain, which is locked in an ssh session: over ssh they say `usage unknown` / `login_required`. Run them in the mini's Terminal (`printf '%s\n' '<cmd> > /tmp/x 2>&1' | mini run`, then read the file over ssh), or in tmux session `apmtest` when the user wants to watch (`tmux send-keys -t apmtest:0.0 '<cmd>' Enter`, read with `tmux capture-pane -p -t apmtest:0.0`). The same holds for router runs: start them from the mini's Terminal (mini-op uses tmux session `b1`).
- **A Python local-network prompt.** On 2026-10-21 an ensemble Python command reaching the LAN raised "Allow “Python” to find devices on local networks?" (UserNotificationCenter; which command was not pinned down): Allow, since the usage probe needs Strata.
- **Every key chord on the mini: hold the modifier(s), press and release the key, then release the modifier(s) last** (the user, 2026-10-21): `tell application "System Events"` / `key down command` / `delay 0.2` / `key code 9` / `delay 0.2` / `key up command` for Cmd-V; the same for Ctrl-C (`key down control` … `key code 8` … `key up control`). In the Terminal: `ctl/mini chord <mods> <key code>` from this Mac (e.g. `mini chord command 40` clears it, `mini chord control 8` interrupts). JXA's `keyDown("command")` sends nothing useful: use AppleScript's `key down command`. Never a one-shot `keystroke … using … down`: GitHub's device-code boxes got Cmd-V that way as a typed "v", and the code landed one box to the right. Pasting: real click on the field, Escape (closes Chrome's autofill list), then the held Cmd-V. Set the clipboard on the mini with `printf '%s' … | pbcopy`.
- **GitHub's Authorize button needs real focus and mouse input**: use the gh login procedure in `runbooks/install-ensemble.md` 6.2.5; a DOM `.click()` on the disabled button does nothing.
- **A locked screen eats keystrokes.** The mini's screen locks: screenshots come back all black, `ioreg -n Root -d1 -a` shows `CGSSessionScreenIsLocked` true, and keystrokes never reach Terminal while `mini pw` still reports "sent". Check for a lock before trusting a "sent". Unlock with mini-op's `mini pw --lock` (wakes the display, presses Shift, types the password from `/run/secrets/mini-password`, reports "unlocked" or "still locked"), check with `~/apm/bin/shot`, then run `nohup caffeinate -dimsu -t 28800 &` on the mini so it stays unlocked through long runs. It ends after 8 hours: restart it before each long session.
- **The mini can stop at the login window.** With no one logged in (`stat -f%Su /dev/console` prints `root`) nothing reaches a Terminal, and the login window's selected user and focus cannot be checked, so never type there. On 2026-10-24 a reboot alone did not help: auto-login had broken (`/etc/kcpassword` was gone). Run mini-op's `mini-autologin --reboot`: it restores auto-login as root, reboots and waits for the account; if it fails, stop and ask the user to log it in (Screen Sharing: `runbooks/setup-test-env.md` 1.4).
- **An engineer issue needs a `Repo:` line in its description.** Without one it bounces at claim, with a comment saying so.
- **`sbx` over ssh needs the keychain unlocked.** Without it: "SBX could not read Docker credentials because macOS Keychain denied access". Unlock in the same ssh session first, or run `sbx` in a mini tmux pane.
- **`sbx exec` reads stdin.** In a script piped to `zsh -s` it swallows the rest of the script: give it `</dev/null`. `sbx secret rm` without a terminal needs `--force`.
- **A new sandbox runs its own `apt-get` at boot.** An immediate `apt-get install` inside it fails with "Could not get lock /var/lib/apt/lists/lock": wait for the boot run to finish. The shell template has no tmux.
- **`sbx reset` leaves state behind**: `~/.sbx`, `~/Library/Application Support/com.docker.sandboxes` and `~/.local/share/llmman`. Trash them after the reset.
- **`sbx`'s first network-policy choice is global.** The first `sbx create`/`run` asks 1 Open, 2 Balanced, 3 Locked Down; the choice applies to every sandbox (`sbx policy reset` to change it).
- **Outlook signs itself out between sessions.** Sign in again from `ensemble-test-outlook` / `outlook` with `secfield`, then go straight to `outlook.live.com/mail/0/` past "Help protect your account".

## Offline checks

Run from this repo with node (the version in `.node-version`), zsh, bash, tar and shasum. CI runs
each line as is:

```sh
npm ci --ignore-scripts
.github/tools install
npm run lint
npm run format
npm run typecheck
npm run guards
npm test
npm run coverage
```

- `.github/tools install` puts the pinned shellcheck, shfmt, actionlint and typos (`.github/tools.tsv`, each checked by sha256) in `.tools/`; lint, format and their tests need them. CI installs zsh from Ubuntu's archive, unpinned.
- `npm run lint`: every shell file by its shebang (`zsh -n`; `bash -n` and shellcheck), actionlint, typos. `npm run format`: prettier for TS, shfmt for bash, bash lines within 100 columns; `npm run format:write` fixes what it can. `npm run typecheck`: `tsc` strict, then `.github/jxa.ts`, which builds each JXA entry in `mini/ts/` on its own with `mini/ts/jxa.d.ts` and fails unless `mini/js/` holds exactly that output; `npm run jxa:write` rewrites `mini/js/`. `npm run guards`: the repository rules in `tests/guards/`, each tested on a violation and a clean sample. Among them: no Python file or call, JS only as `.github/jxa.ts` builds it into `mini/js/`, comments at most 15% of the source's and 10% of the tests' non-blank chars (plus 500; usage text goes in the `-h` string), and no block of 6 code lines shared by two files unless registered with its reason in `tests/registry/duplicates.json`.
- `npm test` runs every `*.test.ts` under `tests/`. Scripts under test run in a sandbox (`tests/lib/sandbox.ts`): their PATH holds only fakes and allowlisted tools, so `ssh`, `scp`, `osascript`, `security`, `docker`, `curl`, the clipboard, `screencapture`, `tmux` and `opencli` are never real; `HOME` and the secrets dir are temp dirs. Fakes match `osascript` by program file name and arguments, never by program text. The JXA entries' tests (`tests/mini/ts/`) run each entry's source in node against fake JXA globals (`tests/lib/jxa.ts`). The host tests likewise fake `docker` by argv prefix. No test connects to the mini, sends Apple Events, uses a running container or reads credentials.
- Secrets: `tests/lib/canary.test.ts` runs every script that reads a secret (`tests/lib/canary.ts`) with fakes feeding it a canary, and fails if the canary shows up anywhere but its final consumer's stdin; the sandbox's real tools run behind shims that log their argv and env for this. A read that must hold a secret in a variable is registered with its reason in `tests/registry/secret-reads.json`, as is (`"argv": true`) the one line that must pass a secret in argv: `maillink`'s opening of the login link, as `opencli browser eval` takes its code only as an argument.
- Every script and program entry (`mini/`, `ctl/`, `host/`, `.github/`, `.githooks/`, and the JXA entries in `mini/ts/`, which `mini/js/` is built from) has its test at `tests/<path without a leading period or code extension>.test.ts`, asserting exits 0, 1, 2 (and 124 when it can time out; a JXA entry 0 and 1, as osascript exits 1 on any thrown error); `tests/registry/untested.json`, the list of scripts without one, stays empty. The help probe (`tests/lib/help_probe.test.ts`) runs every script with `-h` (exit 0, usage on stdout starting with its name, no stdin read, command run or file written) and with an unknown option (exit 2, stderr starting `<name>: `), but those the sandbox's tripwire (`tests/lib/tripwire.ts`) refuses: registered secrets readers, and registered PATH bypasses that put a dir ahead of PATH (`mini/bin/o` only appends opencli's dirs, so it runs). Shipped files that are not code are listed with their covering tests in `tests/registry/non-code.json`. osascript runs only a `mini/js` program or a file listed in `tests/registry/applescript.json`, never `-e` or stdin, and shell strings embed no osascript program or page JS: page JS is a page program in `mini/ts/page/`, built to `mini/js/page/` and called with `page_js` (`mini/lib/opencli.zsh`), its arguments JSON strings.
- `npm run coverage` runs the suite again with node's TS coverage and the sandbox's shell line trace (zsh and bash DEBUG traps, written to their own fd), then fails unless every managed script ran and 85% of the TS lines and branches and of the shell statements changed since `origin/main` (CI: the PR's base, else the commit the push followed; a push that creates its branch has none, so every line counts) are covered. Commit first: untracked files are not in the diff.
- The host tests (`tests/host/`) also run under bash 3.2.57, built in CI from GNU's tarball, as macOS's `/bin/bash`.
- CI's Image job is the one check that builds the image. When an image input changed (`.github/image-check changed`) and weekly, it builds `host/Dockerfile`'s `image` target with this checkout's stamp (`.github/image-check build`; no `host/start`, proxy or mini, so no mini address), checks its history for secrets and for a copied-in mini ssh config or host key (`history`), then prints a PASS/FAIL table from containers without a network (`smoke`): Claude Code runs, no python3 or sudo, user `agent` non-root, npm and node, the plugin root's `plugin.json` version is the stamp, no `windroc.` or `ensemble.` label, nothing of the plugin under `/home/agent`, `ctl/mini -h` under the ensemble layer's `PATH` from `/tmp`, ssh, zsh, jq and nc, no `mini.conf` or `mini_known_hosts`. Any FAIL fails the job naming its row. Otherwise it reports "No build needed (无需构建)".
- Optional: `git config core.hooksPath .githooks` makes each commit format its staged bash and TS files with the pinned versions.

For changing mini-op's files on the user's Mac, see [host/README.md](host/README.md#change-or-remove).
