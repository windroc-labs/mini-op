# mini-op: an isolated Claude Code that operates the Mac mini over ssh. No secrets in this image.
FROM debian:trixie-20261005-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

# Claude Code's apt repo (stable channel); claude-code.asc is its release signing key,
# fingerprint 31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE (https://code.claude.com/docs/en/setup).
ARG CLAUDE_CODE_VERSION=2.1.308-1
ARG OP_UID=1000

COPY claude-code.asc /etc/apt/keyrings/claude-code.asc
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main" \
      > /etc/apt/sources.list.d/claude-code.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "claude-code=${CLAUDE_CODE_VERSION}" git openssh-client tmux curl jq zsh less procps \
      netcat-openbsd; \
    rm -rf /var/lib/apt/lists/*; \
    useradd -m -u "${OP_UID}" -s /bin/bash op; \
    install -d -o op -g op /opt/mini-op
# Host mini itself (the address and account) is not baked in: host/update installs it.
COPY ssh_config.container /etc/ssh/ssh_config.d/mini-proxy.conf

ENV LANG=C.UTF-8 \
    PATH=/opt/mini-op/ctl:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER op
WORKDIR /opt/mini-op
CMD ["sleep", "infinity"]
