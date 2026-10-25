# apm_version <dir>: print the stamp mini/VERSION carries for the git checkout whose top is <dir>:
# its commit, with -dirty when anything is uncommitted; fail for any other dir.
# Sourced by host/update (bash) and ctl/mini (zsh), so both stamp alike.
apm_version() {
  _apm_prefix=$(git -C "$1" rev-parse --show-prefix 2>/dev/null) && [ -z "$_apm_prefix" ] || return 1
  _apm_commit=$(git -C "$1" rev-parse --verify -q HEAD) || return 1
  if [ -n "$(git -C "$1" status --porcelain)" ]; then _apm_commit=$_apm_commit-dirty; fi
  printf '%s\n' "$_apm_commit"
}
