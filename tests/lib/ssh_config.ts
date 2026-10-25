// The mini's Host block in an ssh config (host/config's ~/.mini-op/ssh_config), read as
// ctl/lib/ssh.zsh's mini_user reads it: `Host` lines naming `mini` turn matching on, keywords in any
// case, a keyword's first value wins. The account (User) counts only when it is a plain login name:
// it becomes a path and a shell word.

export const ACCOUNT = /^[a-z_][a-z0-9_-]*$/;

export type HostMini = { hostName?: string; user?: string };

export function hostMini(text: string): HostMini {
  const found = new Map<string, string>();
  let on = false;
  for (const raw of text.split("\n")) {
    const [key = "", ...values] = raw.trim().split(/\s+/);
    const keyword = key.toLowerCase();
    if (!key || key.startsWith("#")) continue;
    if (keyword === "host") on = values.includes("mini");
    else if (on && !found.has(keyword)) found.set(keyword, values[0] ?? "");
  }
  const mini: HostMini = {};
  const hostName = found.get("hostname");
  const user = found.get("user");
  if (hostName) mini.hostName = hostName;
  if (user && ACCOUNT.test(user)) mini.user = user;
  return mini;
}

// The fake config tests and CI use in place of the user's ~/.mini-op/config.local.yaml (no test
// reads the real one): the mini's address and account, and host/config's ssh_config for them.
export const MINI_HOST = "10.9.8.7";
export const MINI_USER = "tester";
export const FAKE_LOCAL = `mini_host: ${MINI_HOST}\nmini_user: ${MINI_USER}\n`;
export const FAKE_SSH_CONFIG = `Host mini\n    HostName ${MINI_HOST}\n    User ${MINI_USER}\n    Port 22\n`;

// One value written each way the config format allows: host/config and the address guard must
// read every form as the bare value.
export const VALUE_FORMS = ["x", '"x"', "x  # note", '"x"  # note', "x # note"];
