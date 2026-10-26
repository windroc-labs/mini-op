# env_secrets_dir: broker-injected secrets; env/ under the registered test-only override.
env_secrets_dir() {
  print -r -- "${${MINI_OP_SECRETS_DIR:+$MINI_OP_SECRETS_DIR/env}:-/run/ensemble/secrets/env}"
}
# mini_password_file <prefix> <tail>: fail before sending anything without an injected password.
mini_password_file() {
  local file=$(env_secrets_dir)/mini-password
  if [[ ! -f $file || ! -r $file || ! -s $file ]]; then
    print -u2 -r -- "$1: $file is missing, empty or unreadable; import with ensemble-broker login env mini-op-password (host/README.md, Environment definition); $2"
    return 1
  fi
  print -r -- $file
}
