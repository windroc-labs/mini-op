# mini-op

A Docker container on this Mac running Claude Code as user `op`, made to operate the Mac mini test machine (ssh host `mini`; its address and account only in `~/.mini-op/config.local.yaml`, Steps; see `../README.md`) and nothing on this Mac, so it can run with `--dangerously-skip-permissions`.

| What | How |
| --- | --- |
| Image | `mini-op:<claude-code version>`: Debian `trixie-20261005-slim` (digest-pinned), Claude Code from its signed apt repo (version: `ARG CLAUDE_CODE_VERSION` in `Dockerfile`), git, openssh-client, netcat-openbsd (ssh's proxy hop), tmux, curl, jq, zsh. No python3 (FR-68): Claude Code's apt package runs without it, which CI's Image job checks on every image change and weekly (`claude --version` passes, `command -v python3` finds nothing). No secrets. |
| Host files | none mounted; `start` calls `update` to copy `../README.md`, `../status.md`, `../runbooks/`, `../mini/` (the mini's `~/apm/` copy, not on `PATH`, with its `VERSION` file stamped: this checkout's commit, plus `-dirty` when anything is uncommitted; `update` refuses to run outside a git checkout) and `../ctl/` (on `PATH`; its `mini pw`, `mini sudo` and `mini-autologin` read `/run/secrets/mini-password`) into `/opt/mini-op`, the working directory, with `../ctl/CLAUDE.md` (the operator's instructions) as `/opt/mini-op/CLAUDE.md` |
| Persistent state | named volume `mini-op-home` (`/home/op`): Claude login (`~/.claude/.credentials.json`), Claude settings (`~/.claude/settings.json`; `start` sets `promptSuggestionEnabled` false, keeping other keys), ssh key `~/.ssh/id_ed25519` (comment `mini-op container`), `known_hosts` |
| Secrets | `/run/secrets`, a 64k tmpfs only `op` can read; empty after every container start |
| Hardening | `--cap-drop ALL`, `no-new-privileges`, non-root user |
| Network | only `mini-op-net`, a Docker `--internal` network: no direct way out. Its one exit is the container `mini-op-proxy` ([smokescreen](https://github.com/stripe/smokescreen) v0.1.0, the official release tarball pinned by SHA-256 in `proxy/Dockerfile`; on `mini-op-net` and the default bridge, read-only, no published port). It allows `config.yaml`'s `proxy_allowed_domains` (Claude Code's API and claude.ai login) and, of the mini, only its `mini_port` (22; ssh goes through it via `ssh_config.container`'s `ProxyCommand`); `config` generates its smokescreen config and ACL into `~/.mini-op/proxy/` and `start` builds them in. Everything else is denied: this Mac (`host.docker.internal`, the gateway), the LAN and other private ranges, every other internet host. The container's `HTTPS_PROXY`/`HTTP_PROXY` point at it, with `NODE_USE_ENV_PROXY=1`. |

Anyone who can run `docker` on this Mac can read the volume, including the passphrase-less ssh key and the Claude login.

Inside mini-op the other docs, written for an operator on this Mac, read with "this Mac" meaning the container: `op` reaches the mini as `ssh mini` with the volume's key, and nothing on this Mac. This Mac's keychain items other than the mini's password (e.g. `strata-api-key`) are not in the container: ask the user to run a step that needs one.

## Steps

First, on a new Mac, and whenever the mini's address or account changes: put them in `~/.mini-op/config.local.yaml`, outside this repo. It sets only the keys it changes; `config.yaml` lists every key with its default (the address and account empty) and comments. `config` merges the two, checks them (it exits 1 naming what to fill in or fix, and never makes values up) and generates `~/.mini-op/ssh_config` (Host mini, for this Mac's `ssh -F` and the container) and `~/.mini-op/proxy/` (the proxy's config and ACL); `start` and `update` run it themselves. An address, port or `proxy_*` change needs `start` (the proxy's policy is built into its image; `update` refuses until then), an account change only `update`.

```sh
mkdir -p -m 700 ~/.mini-op
printf 'mini_host: %s\nmini_user: %s\n' '<the mini LAN IPv4>' '<the mini account>' > ~/.mini-op/config.local.yaml
~/playground/mini-op/host/config
```

1. Build and check the images (claude runs; the proxy loads its config), then (re)create `mini-op-net` (if missing), `mini-op-proxy` and `mini-op`; a failed build or check exits nonzero and leaves the running containers as they were. It prints `op`'s public key; it makes one only when the volume has none. This restarts the container and clears its tmpfs secrets and tmux sessions; use `update` below for file changes.

   ```sh
   ~/playground/mini-op/host/start
   ```

2. Only with a new volume (new key): let the key into the mini, replacing any older `mini-op container` line.

   ```sh
   docker exec mini-op cat /home/op/.ssh/id_ed25519.pub | ssh -F ~/.mini-op/ssh_config mini 'k=$(cat); f=~/.ssh/authorized_keys; sed -i "" "/ mini-op container\$/d" "$f"; printf "%s\n" "$k" >> "$f"'
   docker exec mini-op ssh -o StrictHostKeyChecking=accept-new mini hostname
   ```

3. Log Claude Code in (once per volume). Open the printed URL in a browser on this Mac and paste the code it shows back at `Paste code here if prompted`.

   ```sh
   docker exec -it mini-op claude auth login
   ```

4. Give it the mini's password (the account's: `mini_user`), after every container start (`start`, a Docker or Mac restart). Type it at the `password:` prompt, which does not echo it; it goes over stdin into the mode-0400 file `/run/secrets/mini-password`, through no keychain:

   ```sh
   docker exec -it mini-op zsh -fc 'stty -echo; printf "password: "; rm -f /run/secrets/mini-password; umask 277; head -n 1 > /run/secrets/mini-password; stty echo; echo'
   ```

5. After every `start` (needs steps 2–3 done), check the network from inside the container. It prints a PASS/FAIL table (Claude answers, `ssh … echo ok` works; this Mac, the LAN, `example.com` and direct `1.1.1.1:443` are blocked) and exits 1 on any FAIL. `--egress-only` skips the Claude and `ssh` checks (CI's Image job runs it so).

   ```sh
   ~/playground/mini-op/host/verify-egress
   ```

6. Work with it. The first start asks to trust `/opt/mini-op`. Detach with Ctrl-b d; the same command reattaches.

   ```sh
   docker exec -it mini-op tmux new -A -s op claude --dangerously-skip-permissions
   ```

7. When not testing, stop it with its proxy; `resume` brings both back, proxy first, and starts `mini-op` only once `mini-op-proxy` runs, recreating nothing (redo step 4). After a stop always use `resume`: never start only `mini-op` (e.g. its start button in Docker Desktop). Never leave `mini-op-proxy` stopped while `mini-op` runs: it is mini-op's only way out.

   ```sh
   ~/playground/mini-op/host/stop
   ~/playground/mini-op/host/resume
   ```

## Deploy to the mini

The mini runs `mini/` as `~/apm/`. After `start` or `update` (both stamp mini/'s `VERSION`), copy it there from mini-op; from this Mac, `~/playground/mini-op/ctl/mini sync` does the same, stamped from the checkout on the spot:

```sh
docker exec mini-op mini sync
```

It unpacks over ssh's stdin into `~/apm.new`, moves `~/apm/state/` (markers, marks, screenshots) in, and swaps it for `~/apm`: files no longer in `mini/` are gone, `~/apm/state/` stays. It writes only `~/apm` and its swap dirs `~/apm.new` and `~/apm.old`: no sudo, no installs. `mini sync --check` exits 1 unless the mini's `~/apm/VERSION` matches this copy's.

After every `mini sync`, the operator smoke-tests the real mini from mini-op, outside CI and read-only. Both commands must exit 0; the second prints `ok` or `FAIL` per script, passing a script only when its `-h` exits 0:

```sh
mini sync --check
ssh mini 'cd ~/apm && rc=0; for f in bin/* runbooks/*/*; do [ -x "$f" ] || continue; if "./$f" -h </dev/null >/dev/null 2>&1; then echo "ok $f"; else echo "FAIL $f"; rc=1; fi; done; exit $rc'
```

## Change or remove

- Refresh files after editing or pulling this repo: run on the user's Mac, from any directory (adjust the checkout path):

  ```sh
  ~/playground/mini-op/host/update
  ```

  The container `mini-op` must already be running. This runs `config`, overlays the Host files listed above in `/opt/mini-op` and, as root, replaces the container's ssh config (`/etc/ssh/ssh_config.d/mini.conf`) with `~/.mini-op/ssh_config`, so a new account takes effect, without rebuilding or restarting: `/run/secrets/mini-password` and tmux sessions stay in place. It copies nothing and exits 1 when the running proxy's policy differs from the config (a changed address, `mini_port` or `proxy_*` key): run `start`. Extra container files are not deleted. A failed copy exits nonzero; fix the cause and rerun (some files may already have been copied). It restamps mini/'s `VERSION`; the mini's `~/apm/` changes only with `mini sync` (Deploy to the mini).
- Allow another host: set `proxy_allowed_domains` in `~/.mini-op/config.local.yaml` to the whole list, `config.yaml`'s hosts plus the new one (another mini port: `mini_port`), rerun `start`, then `verify-egress`. Claude Code's host list: https://code.claude.com/docs/en/network-config; telemetry, update and plugin hosts stay blocked on purpose.
- Newer Claude Code: set `ARG CLAUDE_CODE_VERSION` to a version the stable repo lists (`curl -fsSL https://downloads.claude.ai/claude-code/apt/stable/dists/stable/main/binary-arm64/Packages | grep ^Version`), then rerun `start`.
- Remove everything:

  ```sh
  docker rm -f mini-op mini-op-proxy
  docker network rm mini-op-net
  docker volume rm mini-op-home
  docker image rm $(docker images -q mini-op) $(docker images -q mini-op-proxy)
  ssh -F ~/.mini-op/ssh_config mini 'sed -i "" "/ mini-op container\$/d" ~/.ssh/authorized_keys'
  ```
