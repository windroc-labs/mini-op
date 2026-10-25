# The one timeout wrapper and the poll helpers, poll and backoff (FR-53). Sourced by the mini's zsh
# scripts and by ssh's remote shell, so it keeps to POSIX sh. Callers print their own timeout line.

# with_timeout <secs> <cmd> [args...]: <cmd>'s status, or 124 when <secs> ran out. perl's alarm
# outlives its exec of <cmd>, one program run without a shell: a function or 'x;y' is 127.
with_timeout() {
  case $1 in '' | 0* | *[!0-9]*) return 2 ;; esac
  [ $# -ge 2 ] || return 2
  # The && keeps a caller's errexit from ending the shell before 142 (SIGALRM) becomes 124.
  perl -e 'alarm shift; exec { $ARGV[0] } @ARGV or exit 127' "$@" && return 0
  set -- "$?"
  [ "$1" -ne 142 ] || return 124
  return "$1"
}

# poll <tries> <interval> <cmd> [args...]: 0 once <cmd> succeeds, 124 after <tries> failures,
# sleeping <interval> s between tries. <cmd> runs in the current shell, so a function may set
# variables. Tries are counted, as sh has no float arithmetic for the interval.
poll() {
  local _poll_left _poll_wait
  case $1 in '' | 0* | *[!0-9]*) return 2 ;; esac
  case $2 in '' | .* | *. | *.*.* | *[!0-9.]*) return 2 ;; esac
  [ $# -ge 3 ] || return 2
  _poll_left=$1 _poll_wait=$2
  shift 2
  while :; do
    "$@" && return 0
    _poll_left=$((_poll_left - 1))
    [ "$_poll_left" -gt 0 ] || return 124
    sleep "$_poll_wait"
  done
}

# backoff <secs> <first> <max> <cmd> [args...]: poll with growing gaps. 0 once <cmd> succeeds, 124
# once <secs> s of gaps ran out; the first gap is <first> s, each next one twice the last but at
# most <max> s, the last one cut to what is left of <secs>. Whole seconds only.
backoff() {
  local _backoff_arg _backoff_left _backoff_gap _backoff_max
  for _backoff_arg in "$1" "$2" "$3"; do
    case $_backoff_arg in '' | 0* | *[!0-9]*) return 2 ;; esac
  done
  [ $# -ge 4 ] && [ "$2" -le "$3" ] || return 2
  _backoff_left=$1 _backoff_gap=$2 _backoff_max=$3
  shift 3
  while :; do
    "$@" && return 0
    [ "$_backoff_left" -gt 0 ] || return 124
    [ "$_backoff_gap" -le "$_backoff_left" ] || _backoff_gap=$_backoff_left
    sleep "$_backoff_gap"
    _backoff_left=$((_backoff_left - _backoff_gap))
    _backoff_gap=$((_backoff_gap * 2))
    [ "$_backoff_gap" -le "$_backoff_max" ] || _backoff_gap=$_backoff_max
  done
}
