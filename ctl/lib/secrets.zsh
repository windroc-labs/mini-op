# secrets_dir: the directory holding the mini account's password and other secrets. MINI_OP_SECRETS_DIR is the
# one registered override (tests/registry/secrets.json): only the test sandbox sets it.
secrets_dir() { print -r -- "${MINI_OP_SECRETS_DIR:-/run/secrets}"; }
# env_secrets_dir: where an ensemble environment puts its secrets; env/ under the override.
env_secrets_dir() {
  print -r -- "${${MINI_OP_SECRETS_DIR:+$MINI_OP_SECRETS_DIR/env}:-/run/ensemble/secrets/env}"
}
# mini_password_file <prefix> <tail>: the mini password file, the environment's when it exists (no
# fallback then), else the secrets dir's; one not readable and non-empty prints why and returns 1.
mini_password_file() {
  local env=$(env_secrets_dir)/mini-password direct=$(secrets_dir)/mini-password
  if [[ -e $env ]]; then
    [[ -r $env && -s $env ]] || { print -u2 -r -- "$1: $env is empty or unreadable; $2"; return 1; }
    print -r -- $env
  elif [[ -r $direct && -s $direct ]]; then
    print -r -- $direct
  else
    print -u2 -r -- "$1: no mini password in $env or $direct; the user writes it (host/README.md, Steps 4); $2"
    return 1
  fi
}
