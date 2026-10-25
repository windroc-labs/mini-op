# mini-op

## Routes

| Task | Read |
| --- | --- |
| Before any task | `README.md` › Start here |
| Working from this container | `host/README.md` |
| The environment definition for ensemble | `host/README.md` › Environment definition |
| Machine access, browser | `runbooks/setup-test-env.md` |
| Erasing the mini | `runbooks/return-mini.md` |
| Reconnecting mini-op after the mini was reset | `runbooks/setup-test-env.md` › Reconnect mini-op after a reset |
| Secrets and the mini's password | `README.md` › Rules |
| Screen, clicks, typing, browser | `README.md` › Driving the mini |
| Typing commands, waiting, answering prompts | `README.md` › Waiting and answering |
| Anything unexpected | `README.md` › Gotchas |
| The mini stopped at the login window (console user `root`) | `README.md` › Gotchas |
| What each script does | `README.md` › Scripts |
| Deploying `mini/` and the smoke check | `host/README.md` › Deploy to the mini |
| The container, its network, the password file | `host/README.md` › Steps |
| The current environment, where work stopped (it stays on the Mac: ask the user) | `status.md` |

## Hard rules

1. Secrets never appear in output, argv, env or logs.
2. Never move or resize a window on the mini.
3. Screenshots only with `~/apm/bin/shot`.
4. Only the proxy gets out; ask the user when you need a new host.
5. The docs here are a snapshot: to change one, tell the user.
6. Run `mini sync --check` at the start of every session.
7. On the mini's Terminal, answer and wait only with `mini run` and `~/apm/bin/termwait`; never a script of your own.
8. Install nothing on the mini and never call python3 there.
