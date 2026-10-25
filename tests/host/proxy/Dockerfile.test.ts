import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { proxyDockerfileProblems } from "../../lib/image.ts";
import { REPO } from "../../lib/sandbox.ts";

const TEXT = fs.readFileSync(path.join(REPO, "host/proxy/Dockerfile"), "utf8");

test("the proxy Dockerfile pins smokescreen by checksum and every base by digest", () => {
  assert.deepEqual(proxyDockerfileProblems(TEXT), []);
});

test("an ADD without a checksum fails", () => {
  const text = TEXT.replace(/ADD --checksum=sha256:[0-9a-f]{64} /, "ADD ");
  assert.match(proxyDockerfileProblems(text).join("\n"), /ADD .* has no sha256 checksum/);
});

test("a FROM without a digest fails; an earlier stage name is fine", () => {
  const text = TEXT.replace(
    /^(FROM gcr\.io\/distroless\/static:nonroot)@sha256:[0-9a-f]{64}/m,
    "$1",
  );
  assert.match(proxyDockerfileProblems(text).join("\n"), /FROM gcr\.io.* is not pinned/);
  assert.ok(!proxyDockerfileProblems(TEXT).some((p) => p.includes("fetch-")));
});

test("another release or a missing architecture fails", () => {
  const other = TEXT.replaceAll("v0.1.0/smokescreen_v0.1.0", "v0.2.0/smokescreen_v0.2.0");
  assert.match(proxyDockerfileProblems(other).join("\n"), /smokescreen v0\.1\.0 .* not downloaded/);
  const arm = TEXT.split("\n")
    .filter((line) => !line.includes("linux_arm64"))
    .join("\n");
  assert.match(proxyDockerfileProblems(arm).join("\n"), /linux_arm64/);
});

test("smokescreen runs as 65532 with the config baked into /etc/smokescreen", () => {
  assert.match(TEXT, /^USER 65532:65532$/m);
  assert.ok(TEXT.includes('ENTRYPOINT ["/smokescreen"]'));
  assert.ok(TEXT.includes('CMD ["--config-file", "/etc/smokescreen/config.yaml"]'));
  // host/start passes host/config's generated files as the named context "generated".
  assert.match(TEXT, /^COPY --from=generated .*config\.yaml acl\.yaml \/etc\/smokescreen\/$/m);
});

// BuildKit gives the dir a COPY creates the files' --chmod (moby/buildkit#5943), and both are
// root's: user 65532 reads them as "other", so needs r and x there and must not get w.
test("the config dir and files are readable, not writable, for the proxy user", () => {
  const copies = [...TEXT.matchAll(/^COPY (.*) \/etc\/smokescreen\/?$/gm)].map((m) => m[1] ?? "");
  assert.ok(copies.length > 0);
  for (const args of copies) {
    assert.ok(!args.includes("--chown"), args);
    const mode = /--chmod=([0-7]{3,4})\b/.exec(args)?.[1];
    assert.ok(mode, args);
    const other = parseInt(mode, 8) & 0o7;
    assert.equal(other & 0o5, 0o5, args);
    assert.equal(other & 0o2, 0, args);
  }
});
