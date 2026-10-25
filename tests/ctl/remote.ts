// ctl/ scripts' remote side for their tests: ssh runs the remote command locally against the
// sandbox's ~/apm (sb.mini()), so with_timeout
// really execs the fake osascript.
import { Sandbox, type FakeRule } from "../lib/sandbox.ts";

export async function remote(t: Parameters<typeof Sandbox.create>[0], osascript: FakeRule[]) {
  const sb = await Sandbox.create(t);
  sb.mini();
  sb.fake("ssh", [{ local: true }]);
  sb.fake("osascript", osascript);
  return sb;
}

// The canary (the mini account's password) is on no fake call's argv or env and in neither output stream.
export function onlyOnStdin(sb: Sandbox, out: { stdout: string; stderr: string }): void {
  for (const call of sb.calls()) {
    if (call.argv.join(" ").includes(sb.canary)) throw new Error(`${call.cmd} argv has the canary`);
    if (Object.values(call.env).some((value) => value.includes(sb.canary))) {
      throw new Error(`${call.cmd} env has the canary`);
    }
  }
  if ((out.stdout + out.stderr).includes(sb.canary)) throw new Error("output has the canary");
}
