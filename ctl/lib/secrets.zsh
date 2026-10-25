# secrets_dir: the directory holding the mini account's password and other secrets. MINI_OP_SECRETS_DIR is the
# one registered override (tests/registry/secrets.json): only the test sandbox sets it.
secrets_dir() { print -r -- "${MINI_OP_SECRETS_DIR:-/run/secrets}"; }
