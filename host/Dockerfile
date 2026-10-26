# mini-op: an isolated Claude Code that operates the Mac mini over ssh, and the base of an ensemble
# environment. Built from the repo root (Dockerfile.dockerignore). No secrets in this image.
FROM debian:trixie-20261005-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS image

# Claude Code's apt repo (stable channel); claude-code.asc is its release signing key,
# fingerprint 31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE (https://code.claude.com/docs/en/setup).
ARG CLAUDE_CODE_VERSION=2.1.308-1
ARG AGENT_UID=1000

COPY host/claude-code.asc /etc/apt/keyrings/claude-code.asc
# npm from the registry: Debian's npm pulls in python3 (node-gyp).
ADD --checksum=sha256:c80bd097147cce32e31010b791bab8c71a26a5e10668210ec9d2e7f4c7cea2a1 https://registry.npmjs.org/npm/-/npm-10.9.9.tgz /tmp/npm.tgz
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main" \
      > /etc/apt/sources.list.d/claude-code.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "claude-code=${CLAUDE_CODE_VERSION}" git openssh-client tmux curl jq zsh less procps \
      netcat-openbsd nodejs; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /usr/local/lib/node_modules/npm; \
    tar -xzf /tmp/npm.tgz --no-same-owner --strip-components=1 -C /usr/local/lib/node_modules/npm; \
    rm -f /tmp/npm.tgz; \
    chmod a+rx /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/lib/node_modules/npm/bin/npx-cli.js; \
    ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    useradd -M -u "$AGENT_UID" -U -s /bin/bash agent; \
    install -d -o agent -g agent /home/agent

# The runtime root: the skill, ctl/ (its CLAUDE.md at the root), mini/ and their docs, read-only
# to agent. MINI_OP_VERSION, the checkout's stamp (ctl/lib/version.sh), is required.
ARG MINI_OP_VERSION
COPY skills/ /opt/windroc/mini-op/skills/
COPY ctl/ /opt/windroc/mini-op/ctl/
COPY mini/ /opt/windroc/mini-op/mini/
COPY runbooks/ /opt/windroc/mini-op/runbooks/
COPY README.md /opt/windroc/mini-op/
RUN set -eux; \
    test -n "${MINI_OP_VERSION-}"; \
    cd /opt/windroc/mini-op; \
    mv ctl/CLAUDE.md CLAUDE.md; \
    printf '%s\n' "$MINI_OP_VERSION" > mini/VERSION; \
    chown -R root:root .; \
    chmod -R a+rX,go-w .; \
    mkdir -p /etc/claude-code/.claude/skills; \
    ln -s /opt/windroc/mini-op/skills/mini-op /etc/claude-code/.claude/skills/mini-op
# ssh settings without the mini's address or account: only the env stage below adds those.
COPY host/ssh_config.container /etc/ssh/ssh_config.d/mini-proxy.conf
COPY host/ssh_config.keys /etc/ssh/ssh_config.d/mini-keys.conf

LABEL mini-op.version=$MINI_OP_VERSION
ENV LANG=C.UTF-8 \
    PATH=/opt/windroc/mini-op/ctl:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER agent
WORKDIR /opt/windroc/mini-op
CMD ["sleep", "infinity"]

# The default target host/start builds: the mini's ssh config and host keys from its generated
# context (named build context mini). CI builds the image stage only, so its image holds no mini
# address.
FROM image AS env
COPY --from=mini --chmod=0644 ssh_config /etc/ssh/ssh_config.d/mini.conf
COPY --from=mini --chmod=0644 known_hosts /etc/ssh/mini_known_hosts
