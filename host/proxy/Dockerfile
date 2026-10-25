# mini-op-proxy: smokescreen, mini-op's only way out (start builds it as mini-op-proxy:v0.1.0). No secrets.
# Official v0.1.0 release (github.com/stripe/smokescreen, tag commit 609eb8931420453daf5893509be0b25b21bd9edb):
# the release tarballs, pinned by their SHA256SUMS, on the distroless base of upstream's own Dockerfile.
ARG TARGETARCH

FROM debian:trixie-20261005-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS fetch-amd64
ADD --checksum=sha256:4e1e447449e3cc653dae956208588722b5c8fe8ce894f633adc756a851d1ec46 https://github.com/stripe/smokescreen/releases/download/v0.1.0/smokescreen_v0.1.0_linux_amd64.tar.gz /tmp/smokescreen.tar.gz

FROM debian:trixie-20261005-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS fetch-arm64
ADD --checksum=sha256:f15ddd0dc2b2cbc6d7318f441928939eb9bedfab2a1881508af3096a1e24b7c9 https://github.com/stripe/smokescreen/releases/download/v0.1.0/smokescreen_v0.1.0_linux_arm64.tar.gz /tmp/smokescreen.tar.gz

FROM fetch-${TARGETARCH} AS fetch
RUN tar -xzf /tmp/smokescreen.tar.gz -C /tmp --strip-components=1 && test -x /tmp/smokescreen

FROM gcr.io/distroless/static:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
COPY --from=fetch --chmod=0555 /tmp/smokescreen /smokescreen
# config.yaml and acl.yaml come from the named context "generated", host/config's ~/.mini-op/proxy/
# (host/start passes it). BuildKit also gives /etc/smokescreen, which this COPY creates, the --chmod
# mode (moby/buildkit#5943): 0555 keeps that directory traversable and the files readable for USER
# below, and nothing writable.
COPY --from=generated --chmod=0555 config.yaml acl.yaml /etc/smokescreen/
USER 65532:65532
EXPOSE 4750
ENTRYPOINT ["/smokescreen"]
CMD ["--config-file", "/etc/smokescreen/config.yaml"]
