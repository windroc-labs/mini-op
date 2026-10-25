# mini-op

## Routes

| Task | Read |
| --- | --- |
| Before any task | `README.md` › Start here |
| Working from this container | `host/README.md` |
| Install tests, reruns, upgrades in place | `runbooks/install-ensemble.md` |
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

1. Secrets never appear in output, argv, env or logs.
2. Never move or resize a window on the mini.
3. Screenshots only with `~/apm/bin/shot`.
4. Only the proxy gets out; ask the user when you need a new host.
5. The docs here are a snapshot: to change one, tell the user.
6. Run `mini sync --check` at the start of every session.
7. On the mini's Terminal, answer and wait only with `mini run` and `~/apm/bin/termwait`; never a script of your own.
8. Install nothing on the mini and never call python3 there.
9. Public commands run visibly: `mini exec` for complete noninteractive results, `mini run` for interactive work. Ordinary browser work uses `o` foreground. SSH only transports, reads results or performs a documented exception. Attach the target tmux pane before sending work.
10. Secrets never reach the screen, window titles or shell history. Credential/mail/key-generation steps use protected stdin/files or `o --private`; private replies never print secrets. Page secrets only through secfield; Terminal passwords only at confirmed no-echo prompts. Stop when an external tool cannot isolate its secret output before launch.
