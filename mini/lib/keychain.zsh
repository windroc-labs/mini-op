# The one reader of the mini's keychains (FR-55), sourced by the mini's zsh scripts and by runbook
# steps over ssh, so it keeps to POSIX sh. Its login keychain items are listed in status.md (FR-61);
# <keychain>, a keychain file, is read only to import from it (a project's import script). An ssh
# session's keychain is locked: unlock it first (README.md › Gotchas).

# keychain_read <service> [<account> [<keychain>]]: the item's password on stdout, only ever into a
# pipe; 1 with security's message when it is missing or the keychain is locked.
keychain_read() {
  [ $# -ge 1 ] && [ $# -le 3 ] || return 2
  if [ $# -eq 1 ]; then
    security find-generic-password -s "$1" -w
  elif [ $# -eq 2 ]; then
    security find-generic-password -s "$1" -a "$2" -w
  else
    security find-generic-password -s "$1" -a "$2" -w "$3"
  fi || return 1
}

# keychain_has <service> [<account> [<keychain>]]: 0 when the item exists, else 1; reads no
# password and prints nothing, so a caller can stop before it starts a pipe.
keychain_has() {
  [ $# -ge 1 ] && [ $# -le 3 ] || return 2
  if [ $# -eq 1 ]; then
    security find-generic-password -s "$1"
  elif [ $# -eq 2 ]; then
    security find-generic-password -s "$1" -a "$2"
  else
    security find-generic-password -s "$1" -a "$2" "$3"
  fi >/dev/null 2>&1 || return 1
}
