import assert from "node:assert/strict";
import { test } from "node:test";
import { enclosing, secretScope, stdinFed } from "./secret_sources.ts";
import { commands, shellViews } from "./shell.ts";

const parsed = (text: string) => {
  const views = shellViews(text);
  const [view] = views;
  assert.ok(view);
  return { all: commands(view), scope: secretScope(views) };
};

test("enclosing gives the blocks around a command, innermost first", () => {
  const { all } = parsed("{ { pbpaste; }; } | cat\nwhile true; do (x); done");
  const at = (name: string) => {
    const command = all.find((c) => c.name === name);
    assert.ok(command, name);
    return enclosing(all, command).map((c) => `${c.name}@${c.index}`);
  };
  assert.deepEqual(at("pbpaste"), ["}@13", "}@16"]);
  assert.deepEqual(at("cat"), []);
  assert.deepEqual(at("x"), [")@41", "done@44"]);
});

test("a pipe into a loop or group feeds every command in it", () => {
  const fed = (text: string) => {
    const { all, scope } = parsed(text);
    return [...stdinFed(all, scope)].map((c) => c.name).sort();
  };
  assert.deepEqual(fed("pbpaste | while read l; do x; done"), ["read", "x"]);
  assert.deepEqual(fed("pbpaste | { a; b; }"), ["a", "b", "{"]);
  assert.deepEqual(fed("pbpaste | cat; while read l; do x; done"), ["cat"]);
  assert.deepEqual(fed('pwfile=$(secrets_dir)/alice\nwhile read l < "$pwfile"; do x; done'), [
    "read",
  ]);
});
