// Checks of the image inputs (FR-33): each returns its problems, [] when the input is as pinned.
import { createHash } from "node:crypto";
import * as path from "node:path";
import { REPO } from "./repo.ts";
import type { FakeRule } from "./sandbox.ts";

const DIGEST = /@sha256:[0-9a-f]{64}$/;
const CLAUDE_HOSTS = ["api.anthropic.com", "claude.ai", "claude.com", "platform.claude.com"];
const SMOKESCREEN = (arch: string) =>
  `https://github.com/stripe/smokescreen/releases/download/v0.1.0/smokescreen_v0.1.0_linux_${arch}.tar.gz`;
const DENY_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

// Every FROM pinned by digest, except one naming an earlier stage of the same file.
function fromProblems(text: string): string[] {
  const problems: string[] = [];
  const stages: string[] = [];
  for (const match of text.matchAll(/^FROM\s+(.*)$/gm)) {
    const words = (match[1] ?? "").split(/\s+/).filter((word) => !word.startsWith("--"));
    const image = words[0] ?? "";
    const stage = new RegExp(
      `^${image.replace(/[.*+?^()|[\]\\]/g, "\\$&").replace(/\$\{[^}]*\}/g, ".*")}$`,
    );
    if (!stages.some((name) => stage.test(name)) && !DIGEST.test(image)) {
      problems.push(`FROM ${image} is not pinned by digest`);
    }
    if (words[1]?.toUpperCase() === "AS" && words[2]) stages.push(words[2]);
  }
  return problems;
}

export function dockerfileProblems(text: string): string[] {
  const problems = fromProblems(text);
  const version = /^ARG CLAUDE_CODE_VERSION=(\S*)$/m.exec(text)?.[1];
  if (version === undefined) problems.push("no ARG CLAUDE_CODE_VERSION");
  else if (!/^\d+\.\d+\.\d+-\d+$/.test(version)) {
    problems.push(`CLAUDE_CODE_VERSION ${version} is not exact`);
  }
  if (!text.includes('"claude-code=${CLAUDE_CODE_VERSION}"')) {
    problems.push("claude-code is not installed at ${CLAUDE_CODE_VERSION}");
  }
  return problems;
}

export function proxyDockerfileProblems(text: string): string[] {
  const problems = fromProblems(text);
  const urls: string[] = [];
  for (const match of text.matchAll(/^ADD\s+(.*)$/gm)) {
    const line = match[1] ?? "";
    const url = /https?:\/\/\S+/.exec(line)?.[0];
    if (!url) continue;
    urls.push(url);
    if (!/(^|\s)--checksum=sha256:[0-9a-f]{64}\s/.test(line)) {
      problems.push(`ADD ${url} has no sha256 checksum`);
    }
    if (![SMOKESCREEN("amd64"), SMOKESCREEN("arm64")].includes(url)) {
      problems.push(`ADD ${url} is not a smokescreen v0.1.0 release`);
    }
  }
  for (const arch of ["amd64", "arm64"]) {
    if (!urls.includes(SMOKESCREEN(arch))) {
      problems.push(`smokescreen v0.1.0 linux_${arch} release is not downloaded`);
    }
  }
  return problems;
}

// The OpenPGP v4 fingerprint of an armored key's primary key: SHA-1 over 0x99, the key packet's
// two-byte length and its body.
export function fingerprint(armored: string): string {
  const block =
    /-----BEGIN PGP PUBLIC KEY BLOCK-----\n([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/.exec(
      armored,
    )?.[1];
  if (block === undefined) throw new Error("no PGP public key block");
  const lines = block.split("\n");
  const body = lines.slice(lines.indexOf("") + 1).filter((line) => line && !line.startsWith("="));
  const bytes = Buffer.from(body.join(""), "base64");
  const first = bytes[0] ?? 0;
  let tag: number;
  let length: number;
  let offset: number;
  if (first & 0x40) {
    tag = first & 0x3f;
    const o1 = bytes[1] ?? 0;
    if (o1 < 192) [length, offset] = [o1, 2];
    else if (o1 < 224) [length, offset] = [((o1 - 192) << 8) + (bytes[2] ?? 0) + 192, 3];
    else [length, offset] = [bytes.readUInt32BE(2), 6];
  } else {
    tag = (first >> 2) & 0x0f;
    const size = [1, 2, 4][first & 0x03] ?? 0;
    length =
      size === 1 ? (bytes[1] ?? 0) : size === 2 ? bytes.readUInt16BE(1) : bytes.readUInt32BE(1);
    offset = 1 + size;
  }
  const packet = bytes.subarray(offset, offset + length);
  if (tag !== 6 || packet[0] !== 4) throw new Error("not a v4 public key packet");
  const hash = createHash("sha1");
  hash.update(Buffer.from([0x99, (length >> 8) & 0xff, length & 0xff]));
  hash.update(packet);
  return hash.digest("hex").toUpperCase();
}

type Acl = { default?: { action?: string; allowed_domains?: string[] } };

// Claude's hosts and the mini, whose port config.yaml's allow_addresses limits to its ssh port.
export function aclProblems(acl: Acl, mini: string): string[] {
  const problems: string[] = [];
  const domains = acl.default?.allowed_domains ?? [];
  const expected = [...CLAUDE_HOSTS, mini];
  for (const host of domains.filter((d) => !expected.includes(d))) {
    problems.push(`allowed_domains has ${host}, neither a Claude host nor the mini`);
  }
  for (const host of expected.filter((d) => !domains.includes(d))) {
    problems.push(`allowed_domains misses ${host}`);
  }
  if (acl.default?.action !== "enforce") {
    problems.push(`default action is ${acl.default?.action}, not enforce`);
  }
  return problems;
}

type Config = { allow_addresses?: string[]; deny_ranges?: string[] };

export function configProblems(config: Config, mini: string, port = 22): string[] {
  const problems: string[] = [];
  const allowed = config.allow_addresses ?? [];
  if (allowed.length !== 1 || allowed[0] !== `${mini}:${port}`) {
    problems.push(`allow_addresses must be exactly ${mini}:${port}, not ${allowed.join(", ")}`);
  }
  for (const range of DENY_RANGES.filter((r) => !(config.deny_ranges ?? []).includes(r))) {
    problems.push(`deny_ranges misses ${range}`);
  }
  return problems;
}

// Fake docker's answer to host/update's check of the running proxy's policy label: the policy
// host/config generated in the sandbox HOME, as a proxy host/start just built would carry.
export const PROXY_LABEL = ["inspect", "-f", '{{index .Config.Labels "mini-op.proxy-policy"}}'];
export const PROXY_POLICY: FakeRule = {
  argv: [...PROXY_LABEL, "mini-op-proxy"],
  shell: `bash '${path.join(REPO, "host/config")}' policy-hash`,
};
