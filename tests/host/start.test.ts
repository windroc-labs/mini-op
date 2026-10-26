import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { REPO, Sandbox, type FakeRule } from "../lib/sandbox.ts";
import { FAKE_LOCAL, MINI_HOST } from "../lib/ssh_config.ts";

const START = path.join(REPO, "host/start");
const IMAGE = "mini-op:env";
const GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"];
const KEEP_CONTEXT = 'for a; do [[ $a == mini=* ]] && cp -R "${a#mini=}" "$FAKE_DIR/context"; done; true';
const HOST_KEYS = ["|1|c2FsdA==|aGFzaA== ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKey"];
const KEYGEN: FakeRule = { argv: ["-F"], stdout: `# Host ${MINI_HOST} found: line 3\n${HOST_KEYS.join("\n")}\n` };
function docker(extra: FakeRule[] = []): FakeRule[] {
  return [...extra, { argv: ["info"] }, { argv: ["ps"] }, { argv: ["network", "ls"] },
    { argv: ["volume", "ls"] }, { argv: ["build"], shell: KEEP_CONTEXT }];
}
async function start(t: Parameters<typeof Sandbox.create>[0], extra: FakeRule[] = [], args: string[] = [],
  script = START, sandbox?: Sandbox, keygen: FakeRule[] = [KEYGEN], delegate: FakeRule = {}) {
  const sb = sandbox ?? await Sandbox.create(t);
  sb.fake("docker", docker(extra));
  sb.fake("ssh-keygen", keygen);
  sb.fake("ensemble-delegate", [{ ...delegate, shell: 'umask > "$FAKE_DIR/delegate-umask"' }]);
  const r = await sb.run(["bash", script, ...args]);
  return { sb, r };
}
const values = (argv: string[], ...flags: string[]) => argv.filter((_, i) => i > 0 && flags.includes(argv[i - 1]!));

test("builds only env, then delegates with fixed Claude, cwd and umask 022", async t => {
  const {sb,r}=await start(t);
  assert.equal(r.code,0,r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, "");
  assert.deepEqual(sb.calls("ensemble-delegate").map(c=>c.argv), [["open","mini-op","--environment","mini-op","--client","claude","--cwd",path.join(sb.home,".mini-op/workspace")]]);
  assert.ok(fs.statSync(path.join(sb.home,".mini-op/workspace")).isDirectory());
  assert.match(fs.readFileSync(path.join(sb.dir,"delegate-umask"),"utf8"), /^0*22\n$/);
  const calls=sb.calls("docker").map(c=>c.argv);
  assert.deepEqual(calls.map(a=>a[0]),["info","ps","network","volume","build"]);
  const build=calls.at(-1)!;
  assert.deepEqual(values(build,"-t"),[IMAGE]);
  assert.deepEqual(values(build,"--build-arg"),[`MINI_OP_VERSION=${await headStamp(sb)}`]);
  const kept=path.join(sb.dir,"context");
  assert.equal(fs.readFileSync(path.join(kept,"known_hosts"),"utf8"),HOST_KEYS.join("\n")+"\n");
  assert.equal(fs.readFileSync(path.join(kept,"ssh_config"),"utf8"),fs.readFileSync(path.join(sb.home,".mini-op/ssh_config"),"utf8"));
  for(const f of ["ssh_config","known_hosts"]) assert.equal(fs.statSync(path.join(kept,f)).mode & 0o077,0);
  assert.deepEqual(fs.readdirSync(path.join(sb.dir,"tmp")),[]);
});

test("delegate status and stderr pass through unchanged",async t=>{
  for(const code of [0,1,2,75]){
    const sb=await Sandbox.create(t);
    sb.fake("docker",docker()); sb.fake("ssh-keygen",[KEYGEN]);
    sb.fake("ensemble-delegate",[{exit:code,stderr:"broker: occupied by verifier-42\n",stdout:"TUI\n"}]);
    const r=await sb.run(["bash",START]);
    assert.equal(r.code,code); assert.equal(r.stderr,"broker: occupied by verifier-42\n"); assert.equal(r.stdout,"TUI\n");
    assert.deepEqual(fs.readdirSync(path.join(sb.dir,"tmp")),[]);
  }
});
test("failed build never delegates",async t=>{
  const {sb,r}=await start(t,[{argv:["build"],exit:1,stderr:"build error\n"}]);
  assert.equal(r.code,1); assert.match(r.stderr,/building mini-op:env failed/);
  assert.deepEqual(sb.calls("ensemble-delegate"),[]);
});
test("each old resource blocks before any build or delegate",async t=>{
  const name="mini-op";
  for(const [argv,resource] of [ [["ps"],name], [["ps"],`${name}-proxy`], [["network","ls"],`${name}-net`], [["volume","ls"],`${name}-home`] ] as [string[],string][]){
    const {sb,r}=await start(t,[{argv,stdout:`other\n${resource}\n`}]);
    assert.equal(r.code,1,resource); assert.match(r.stderr,/host\/README\.md.*从旧版升级/);
    assert.ok(sb.calls("docker").every(c=>["info","ps","network","volume"].includes(c.argv[0]!)));
    assert.deepEqual(sb.calls("ensemble-delegate"),[]);
  }
});
test("query failures are not treated as absence",async t=>{
  for(const argv of [["info"],["ps"],["network","ls"],["volume","ls"]]){
    const {sb,r}=await start(t,[{argv,exit:1,stderr:"daemon unavailable\n"}]);
    assert.equal(r.code,1); assert.ok(sb.calls("docker").every(c=>c.argv[0]!=="build"));
    assert.deepEqual(sb.calls("ensemble-delegate"),[]);
  }
});
test("unrelated resources and an existing workspace are preserved",async t=>{
  const sb=await Sandbox.create(t);
  const ws=path.join(sb.home,".mini-op/workspace"); fs.mkdirSync(ws); fs.writeFileSync(path.join(ws,"keep"),"data");
  const {r}=await start(t,[{argv:["ps"],stdout:"mini-op-other\n"}],[],START,sb);
  assert.equal(r.code,0,r.stderr); assert.equal(fs.readFileSync(path.join(ws,"keep"),"utf8"),"data");
});
test("the configured endpoint's confirmed host key is required",async t=>{
  for(const port of ["22","2222"]){
    const sb=await Sandbox.create(t); fs.writeFileSync(path.join(sb.home,".mini-op/config.local.yaml"),`${FAKE_LOCAL}mini_port: ${port}\n`);
    const {r}=await start(t,[],[],START,sb);
    assert.equal(r.code,0,r.stderr);
    assert.deepEqual(sb.calls("ssh-keygen")[0]?.argv,["-F",port==="22"?MINI_HOST:`[${MINI_HOST}]:${port}`,"-f",path.join(sb.home,".mini-op/known_hosts")]);
  }
  for(const keygen of [[{exit:1}],[{stdout:"# no confirmed key\n"}]]){
    const {sb,r}=await start(t,[],[],START,undefined,keygen);
    assert.equal(r.code,1); assert.match(r.stderr,/known_hosts has no host key/);
    assert.ok(sb.calls("docker").every(c=>c.argv[0]!=="build"));
    assert.deepEqual(sb.calls("ensemble-delegate"),[]);
  }
});
// This checkout's stamp as ctl/lib/version.sh makes it: HEAD, -dirty with uncommitted changes.
async function headStamp(sb: Sandbox, dir = REPO): Promise<string> {
  const head = (await sb.run(["git", "-C", dir, "rev-parse", "HEAD"])).stdout.trim();
  const status = (await sb.run(["git", "-C", dir, "status", "--porcelain"])).stdout;
  return status ? `${head}-dirty` : head;
}

// A committed copy of what start needs from this repo, in the sandbox, plus `untracked` files.
async function checkout(sb: Sandbox, untracked: string[] = []): Promise<string> {
  const copy = path.join(sb.dir, "checkout");
  fs.mkdirSync(copy);
  for (const name of [".gitignore", "README.md", "runbooks", "skills", "mini", "ctl", "host"]) {
    fs.cpSync(path.join(REPO, name), path.join(copy, name), { recursive: true });
  }
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["commit", "-q", "-m", "c"],
  ]) {
    assert.equal((await sb.run([...GIT, "-C", copy, ...args])).code, 0);
  }
  for (const file of untracked) fs.writeFileSync(path.join(copy, file), "x\n");
  return copy;
}

test("a checkout's commit is the stamp; untracked files the image does not take only dirty it", async (t) => {
  for (const untracked of [[], ["notes.txt"]]) {
    const sb = await Sandbox.create(t);
    const copy = await checkout(sb, untracked);
    const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
    assert.equal(r.code, 0, r.stderr);
    const head = (await sb.run(["git", "-C", copy, "rev-parse", "HEAD"])).stdout.trim();
    const stamp = untracked.length ? `${head}-dirty` : head;
    const build = sb.calls("docker").find(({ argv }) => argv[0] === "build")?.argv ?? [];
    assert.deepEqual(values(build, "-f", "--build-arg"), [
      path.join(copy, "host/Dockerfile"),
      `MINI_OP_VERSION=${stamp}`,
    ]);
    assert.equal(build.at(-1), copy);

  }
});

test("untracked files the image would take exit 1, naming them, before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb, ["runbooks/x.md"]);
  // CI's shipped dirs are read-only, and the copy keeps their modes.
  fs.chmodSync(path.join(copy, "skills"), 0o755);
  fs.mkdirSync(path.join(copy, "skills/new"));
  fs.writeFileSync(path.join(copy, "skills/new/SKILL.md"), "x\n");
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "start: untracked or ignored files would be built into the image:" +
      " runbooks/x.md" +
      " skills/new/SKILL.md; commit or remove them\n",
  );
  assert.equal(r.stdout, "");
  assert.ok(sb.calls("docker").every(({ argv }) => argv[0] !== "build"));
});

// Writes `file` in the checkout copy; CI's shipped dirs are read-only, and the copy keeps their modes.
function put(copy: string, file: string): void {
  fs.chmodSync(path.join(copy, file.split("/")[0]!), 0o755);
  fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
  fs.writeFileSync(path.join(copy, file), "x\n");
}

test("ignored files the image would take exit 1, naming them, before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb);
  fs.appendFileSync(path.join(copy, ".git/info/exclude"), ".DS_Store\n");
  put(copy, "mini/.DS_Store");
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    "start: untracked or ignored files would be built into the image: mini/.DS_Store; commit or" +
      " remove them\n",
  );
  assert.equal(r.stdout, "");
  assert.ok(sb.calls("docker").every(({ argv }) => argv[0] !== "build"));
});

// A path for each exclusion line of host/Dockerfile.dockerignore: the build never takes it.
const EXCLUDED: Record<string, string> = {
  "mini/VERSION": "mini/VERSION",
  "**/node_modules": "ctl/node_modules/x",
  "**/.tools": "skills/.tools/x",
};

test("each exclusion of host/Dockerfile.dockerignore after its allowlist has a case here", () => {
  const lines = fs
    .readFileSync(path.join(REPO, "host/Dockerfile.dockerignore"), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  const excluded = lines.slice(lines.findLastIndex((line) => line.startsWith("!")) + 1);
  assert.deepEqual(excluded, Object.keys(EXCLUDED));
  for (const [line, file] of Object.entries(EXCLUDED)) {
    const name = line.replace(/^\*\*\//, "");
    assert.ok(line === name ? file === name : file.split("/").includes(name), line);
  }
});

test("ignored files host/Dockerfile.dockerignore leaves out do not stop the build", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = await checkout(sb);
  for (const file of Object.values(EXCLUDED)) put(copy, file);
  const status = await sb.run([
    ...["git", "-C", copy, "status", "--porcelain", "--untracked-files=all", "--ignored"],
  ]);
  assert.deepEqual(
    status.stdout.split("\n").filter(Boolean).sort(),
    Object.values(EXCLUDED)
      .map((file) => `!! ${file}`)
      .sort(),
  );
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
});

test("outside a git checkout it exits 1 before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  const copy = path.join(sb.dir, "plain");
  for (const file of ["host/start", "host/config", "host/config.yaml", "ctl/lib/version.sh"]) {
    fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(copy, file));
  }
  const { r } = await start(t, [], [], path.join(copy, "host/start"), sb);
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    `start: ${copy} is not a git checkout; cannot stamp the runtime version\n`,
  );
  assert.ok(sb.calls("docker").every(({ argv }) => argv[0] !== "build"));
});

test("a config failure exits 1 before any docker call", async (t) => {
  const sb = await Sandbox.create(t);
  fs.rmSync(path.join(sb.home, ".mini-op/config.local.yaml"));
  sb.fake("docker", docker());
  const r = await sb.run(["bash", START]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^config: no .*config\.local\.yaml; create it/);
  assert.ok(r.stderr.endsWith("start: host/config failed; nothing built or changed\n"), r.stderr);
  assert.ok(sb.calls("docker").every(({ argv }) => argv[0] !== "build"));
});

test("-h prints the usage to stdout and runs nothing", async (t) => {
  const { sb, r } = await start(t, [], ["-h"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^start /);
  assert.match(r.stdout, /host key[^.]*~\/\.mini-op\/known_hosts/);
  assert.equal(r.stderr, "");
  assert.deepEqual(sb.calls(), []);
});

test("any argument is a usage error and runs nothing", async (t) => {
  for (const arg of ["now", "--bogus"]) {
    const { sb, r } = await start(t, [], [arg]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "start: usage: start\n");
    assert.deepEqual(sb.calls(), []);
  }
});
