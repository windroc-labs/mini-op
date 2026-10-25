# mini-op

## Routes

| Task | Read |
| --- | --- |
| Before any task | `README.md` › Start here |
| Working from this container | `host/README.md` |
| Install tests, reruns, upgrades in place | `runbooks/install-ensemble.md` |
| OpenCode install flags and prompt answers | `runbooks/install-ensemble.md` › OpenCode-only install |
| OpenCode board roles on tmux | `runbooks/manager-on-mini.md` › OpenCode board runs on the tmux Host |
| Cleanup and the post-test check | `runbooks/clean-ensemble.md` |
| Machine access, browser, Outlook, GitHub (`dotpm2026`), Linear, API keys | `runbooks/setup-test-env.md` |
| The manager on the mini | `runbooks/manager-on-mini.md` |
| Erasing the mini | `runbooks/return-mini.md` |
| Reconnecting mini-op after the mini was reset | `runbooks/setup-test-env.md` › Reconnect mini-op after a reset |
| Secrets and the mini's password | `README.md` › Rules |
| Screen, clicks, typing, browser | `README.md` › Driving the mini |
| Visible routes, protected exceptions, complete result recovery | `runbooks/visible-operations.md` |
| Typing commands, waiting, answering prompts | `README.md` › Waiting and answering |
| Anything unexpected | `README.md` › Gotchas |
| The mini stopped at the login window (console user `root`) | `README.md` › Gotchas |
| What each script does | `README.md` › Scripts |
| Deploying `mini/` and the smoke check | `host/README.md` › Deploy to the mini |
| The container, its network, the password file | `host/README.md` › Steps |
| The current environment, where work stopped | `status.md` |

## Hard rules

1. Secrets never appear on screen, in titles, shell history, output, argv, env or logs. Use protected stdin/files or private browser steps; page input only through secfield, Terminal passwords only at confirmed no-echo prompts. Stop if secret output cannot be isolated before launch.
2. Never move or resize a window on the mini.
3. Screenshots only with `~/apm/bin/shot`.
4. Only the proxy gets out; ask the user when you need a new host.
5. The docs here are a snapshot: to change one, tell the user.
6. Run `mini sync --check` at the start of every session.
7. Public work runs visibly: `mini exec` for complete noninteractive results, `mini run/termwait` for interaction; ordinary browser work uses `o` foreground. SSH only transports, reads results or performs a documented exception. Attach tmux's target pane first; use no custom answer/wait script.
8. Install nothing on the mini and never call python3 there.
