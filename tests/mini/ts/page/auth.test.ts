import assert from "node:assert/strict";
import { test } from "node:test";
import { Page, type Scene } from "../../../lib/page.ts";

const LINK = "https://linear.app/auth/email/a@b.c/secret-code";
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("auth consumes a link with cookies and exposes only a safe final path", async () => {
  const scene: Scene = {
    href: "https://linear.app/login",
    fetch: { url: "https://linear.app/workspace?secret=ignored#secret" },
  };
  const page = Page.source("auth", scene);
  const r = page.opencli(LINK);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{"ok":true,"data":"pending"}\n');
  await flush();
  assert.equal(scene.auth, "/workspace");
  assert.deepEqual(page.events, [
    { type: "fetch", url: LINK, credentials: "include", redirect: "follow" },
  ]);
});

test("auth refuses untrusted links and wrong-origin pages before fetching", async () => {
  for (const [href, link] of [
    ["https://evil.test", LINK],
    ["https://linear.app/login", "https://linear.app.evil/auth/email/x"],
    ["https://linear.app/login", `${LINK}'`],
  ]) {
    const scene: Scene = { href };
    const page = Page.source("auth", scene);
    assert.equal(page.call(link!), "failed");
    await flush();
    assert.deepEqual(page.events, []);
    assert.equal(scene.auth, "failed");
  }
});

test("auth rejects failed requests, unsafe redirects and malformed responses", async () => {
  for (const response of [
    { ok: false },
    { error: true },
    { url: "invalid" },
    { url: "https://evil.test/workspace" },
    { url: LINK },
    { url: "https://linear.app/login" },
    { url: "https://linear.app/a%20b" },
  ]) {
    const scene: Scene = { href: "https://linear.app/login", fetch: response };
    const page = Page.source("auth", scene);
    assert.equal(page.call(LINK), "pending");
    await flush();
    assert.equal(scene.auth, "failed");
    assert.ok(!page.events.some((event) => event.type === "navigate"));
  }
});

test("page exceptions and compiled auth use the same protected result", async () => {
  const bad = Page.source("auth", { href: "invalid" }).opencli(LINK);
  assert.equal(bad.code, 1);
  assert.ok(!bad.stdout.includes("secret-code"));
  const scene: Scene = { href: "https://linear.app/login" };
  assert.equal(Page.compiled("auth", scene).call(LINK), "pending");
  await flush();
  assert.equal(scene.auth, "/workspace");
});
