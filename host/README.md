# mini-op

A Docker container on this Mac running Claude Code as user `agent`, made to operate the Mac mini test machine (ssh host `mini`; its address and account only in `~/.mini-op/config.local.yaml`, Steps; see `../README.md`) and nothing on this Mac, so it can run with `--dangerously-skip-permissions`.

| What | How |
| --- | --- |
| Image | `mini-op:env`, whatever the Claude Code version: Debian `trixie-20261005-slim` (digest-pinned), Claude Code from its signed apt repo (version: `ARG CLAUDE_CODE_VERSION` in `Dockerfile`), git, openssh-client, netcat-openbsd (ssh's proxy hop), tmux, curl, jq, zsh, Debian's Node.js and npm (the registry tarball, pinned by SHA-256 in `Dockerfile`). User `agent` (uid and gid 1000), no sudo. The plugin root `/opt/windroc/plugins/mini-op/`, the working directory, root-owned and read-only to `agent`: the plugin (`../plugin/`), `../ctl/` (on `PATH`) with `../ctl/CLAUDE.md` (the operator's instructions) as `/opt/windroc/plugins/mini-op/CLAUDE.md`, `../mini/` (the mini's `~/apm/` copy, not on `PATH`), `../README.md` and `../runbooks/`. The mini's ssh settings (`~/.mini-op/ssh_config`) and its host key (this Mac's `~/.ssh/known_hosts` entry) are built in: the image's ssh (`ssh_config.keys`) trusts only that key, never asks about or adds one, and uses `/run/ensemble/secrets/env/mini-ssh-key` when an environment gives it, else the volume's key. No python3 (FR-68): Claude Code's apt package runs without it, which CI's Image job checks on every image change and weekly (`claude --version` passes, `command -v python3` finds nothing). No secrets. |
| Host files | none mounted: `start` bakes the Image's files in at build, stamped with this checkout's commit (plus `-dirty` when anything is uncommitted) as the plugin's version and mini/'s `VERSION`; it refuses to build outside a git checkout or with untracked or ignored files under `../ctl/`, `../mini/`, `../runbooks/` or `../plugin/` (other than what `Dockerfile.dockerignore` leaves out). `../status.md` stays on this Mac. `ctl/`'s `mini pw`, `mini sudo` and `mini-autologin` read `/run/secrets/mini-password` |
| Persistent state | named volume `mini-op-home` (`/home/agent`): Claude login (`~/.claude/.credentials.json`), Claude settings (`~/.claude/settings.json`; `start` sets `promptSuggestionEnabled` false, keeping other keys), ssh key `~/.ssh/id_ed25519` (comment `mini-op container`) |
| Secrets | `/run/secrets`, a 64k tmpfs only `agent` can read; empty after every container start |
| Hardening | `--cap-drop ALL`, `no-new-privileges`, non-root user |
| Network | only `mini-op-net`, a Docker `--internal` network: no direct way out. Its one exit is the container `mini-op-proxy` ([smokescreen](https://github.com/stripe/smokescreen) v0.1.0, the official release tarball pinned by SHA-256 in `proxy/Dockerfile`; on `mini-op-net` and the default bridge, read-only, no published port). It allows `config.yaml`'s `proxy_allowed_domains` (Claude Code's API and claude.ai login) and, of the mini, only its `mini_port` (22; ssh goes through it via `ssh_config.container`'s `ProxyCommand`); `config` generates its smokescreen config and ACL into `~/.mini-op/proxy/` and `start` builds them in. Everything else is denied: this Mac (`host.docker.internal`, the gateway), the LAN and other private ranges, every other internet host. The container's `HTTPS_PROXY`/`HTTP_PROXY` point at it, with `NODE_USE_ENV_PROXY=1`. |

Anyone who can run `docker` on this Mac can read the volume, including the passphrase-less ssh key and the Claude login.

Inside mini-op the other docs, written for an operator on this Mac, read with "this Mac" meaning the container: `agent` reaches the mini as `ssh mini` with the volume's key, and nothing on this Mac. This Mac's keychain items other than the mini's password (e.g. `strata-api-key`) are not in the container: ask the user to run a step that needs one.

## Steps

First, on a new Mac, and whenever the mini's address or account changes: put them in `~/.mini-op/config.local.yaml`, outside this repo. It sets only the keys it changes; `config.yaml` lists every key with its default (the address and account empty) and comments. `config` merges the two, checks them (it exits 1 naming what to fill in or fix, and never makes values up) and generates `~/.mini-op/ssh_config` (Host mini, for this Mac's `ssh -F` and the container) and `~/.mini-op/proxy/` (the proxy's config and ACL); `start` runs it itself. Any change to them takes effect with `stop`, then `start`: both images are built with them.

```sh
mkdir -p -m 700 ~/.mini-op
printf 'mini_host: %s\nmini_user: %s\n' '<the mini LAN IPv4>' '<the mini account>' > ~/.mini-op/config.local.yaml
~/playground/mini-op/host/config
```

Then, once per mini and after its host key changes (`../runbooks/setup-test-env.md`, section Reconnect mini-op after a reset): note the mini's host-key fingerprint (on the mini, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) and confirm it on this Mac, answering yes only when ssh shows the same fingerprint. `start` bakes this Mac's `~/.ssh/known_hosts` entry for the mini into the image and exits 1 without one.

```sh
ssh -F ~/.mini-op/ssh_config mini true
```

1. Build and check the images (claude runs; the proxy loads its config), then (re)create `mini-op-net` (if missing), `mini-op-proxy` and `mini-op`; a failed build or check exits nonzero and leaves the running containers as they were. It prints `agent`'s public key; it makes one only when the volume has none. This restarts the container and clears its tmpfs secrets and tmux sessions.

   ```sh
   ~/playground/mini-op/host/start
   ```

2. Only with a new volume (new key): let the key into the mini, replacing any older `mini-op container` line.

   ```sh
   docker exec mini-op cat /home/agent/.ssh/id_ed25519.pub | ssh -F ~/.mini-op/ssh_config mini 'k=$(cat); f=~/.ssh/authorized_keys; sed -i "" "/ mini-op container\$/d" "$f"; printf "%s\n" "$k" >> "$f"'
   ```

3. Log Claude Code in (once per volume). Open the printed URL in a browser on this Mac and paste the code it shows back at `Paste code here if prompted`.

   ```sh
   docker exec -it mini-op claude auth login
   ```

4. Give it the mini's password (the account's: `mini_user`), after every container start (`start`, a Docker or Mac restart). Type it at the `password:` prompt, which does not echo it; it goes over stdin into the mode-0400 file `/run/secrets/mini-password`, through no keychain:

   ```sh
   docker exec -it mini-op zsh -fc 'stty -echo; printf "password: "; rm -f /run/secrets/mini-password; umask 277; head -n 1 > /run/secrets/mini-password; stty echo; echo'
   ```

5. After every `start` (needs steps 2–3 done), check the network from inside the container. It prints a PASS/FAIL table (Claude answers, `ssh … echo ok` works; this Mac, the LAN, `example.com` and direct `1.1.1.1:443` are blocked) and exits 1 on any FAIL. `--egress-only` skips the Claude and `ssh` checks.

   ```sh
   ~/playground/mini-op/host/verify-egress
   ```

6. Work with it. The first start asks to trust the plugin root `/opt/windroc/plugins/mini-op/`. Detach with Ctrl-b d; the same command reattaches.

   ```sh
   docker exec -it mini-op tmux new -A -s op claude --dangerously-skip-permissions
   ```

7. When not testing, stop it with its proxy; `resume` brings both back, proxy first, and starts `mini-op` only once `mini-op-proxy` runs, recreating nothing (redo step 4). After a stop always use `resume`: never start only `mini-op` (e.g. its start button in Docker Desktop). Never leave `mini-op-proxy` stopped while `mini-op` runs: it is mini-op's only way out.

   ```sh
   ~/playground/mini-op/host/stop
   ~/playground/mini-op/host/resume
   ```

## Deploy to the mini

The mini runs `mini/` as `~/apm/`. After `start` (it stamps mini/'s `VERSION` in the image), copy it there from mini-op; from this Mac, `~/playground/mini-op/ctl/mini sync` does the same, stamped from the checkout on the spot:

```sh
docker exec mini-op mini sync
```

It unpacks over ssh's stdin into `~/apm.new`, moves `~/apm/state/` (markers, marks, screenshots) in, and swaps it for `~/apm`: files no longer in `mini/` are gone, `~/apm/state/` stays. It writes only `~/apm` and its swap dirs `~/apm.new` and `~/apm.old`: no sudo, no installs. `mini sync --check` exits 1 unless the mini's `~/apm/VERSION` matches this copy's.

After every `mini sync`, the operator smoke-tests the real mini from mini-op, outside CI and read-only. Both commands must exit 0; the second prints `ok` or `FAIL` per script, passing a script only when its `-h` exits 0:

```sh
mini sync --check
ssh mini 'cd ~/apm && rc=0; for f in bin/* runbooks/*/*(N); do [ -x "$f" ] || continue; if "./$f" -h </dev/null >/dev/null 2>&1; then echo "ok $f"; else echo "FAIL $f"; rc=1; fi; done; exit $rc'
```

## Change or remove

- Files take effect only through a rebuild: after editing or pulling this repo, run on the user's Mac, from any directory (adjust the checkout path):

  ```sh
  ~/playground/mini-op/host/stop
  ~/playground/mini-op/host/start
  ```

  This rebuilds `mini-op:env` with the new `ctl/`, `mini/`, docs, ssh config (`~/.mini-op/ssh_config`) and host key and recreates both containers: redo step 4 and reattach (step 6). Nothing is copied into a running container. The mini's `~/apm/` changes only with `mini sync` (Deploy to the mini).
- The mini's host key changed (ssh in the container fails): `../runbooks/setup-test-env.md`, section Reconnect mini-op after a reset, steps 5–6: drop it on this Mac only, confirm the new one, then `stop` and `start`.
- Allow another host: set `proxy_allowed_domains` in `~/.mini-op/config.local.yaml` to the whole list, `config.yaml`'s hosts plus the new one (another mini port: `mini_port`), rerun `start`, then `verify-egress`. Claude Code's host list: https://code.claude.com/docs/en/network-config; telemetry, update and plugin hosts stay blocked on purpose.
- Newer Claude Code: set `ARG CLAUDE_CODE_VERSION` to a version the stable repo lists (`curl -fsSL https://downloads.claude.ai/claude-code/apt/stable/dists/stable/main/binary-arm64/Packages | grep ^Version`), then `stop` and `start`: `mini-op:env` then names the new image.
- Remove everything:

  ```sh
  docker rm -f mini-op mini-op-proxy
  docker network rm mini-op-net
  docker volume rm mini-op-home
  docker image rm $(docker images -q mini-op) $(docker images -q mini-op-proxy)
  ssh -F ~/.mini-op/ssh_config mini 'sed -i "" "/ mini-op container\$/d" ~/.ssh/authorized_keys'
  ```
