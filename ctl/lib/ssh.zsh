# mini_ssh <ssh args>: ssh to Host mini. When this ctl/ sits in a checkout beside host/ (the
# MacBook), through ~/.mini-op/ssh_config, which host/config generates from
# ~/.mini-op/config.local.yaml. The container has no host/: host/start builds that file, and the
# proxy hop, into the image's own ssh config.
_mini_ssh_config=
if [[ -e ${${(%):-%x}:A:h:h:h}/host/config ]]; then _mini_ssh_config=$HOME/.mini-op/ssh_config; fi
mini_ssh() {
  if [[ -n $_mini_ssh_config ]]; then ssh -F "$_mini_ssh_config" "$@"; else ssh "$@"; fi
}
# mini_user [prefix]: the mini's account, the first User under Host mini in the file mini_ssh uses
# (~/.mini-op/ssh_config, or the container's copy), read with builtins only. A missing or invalid
# one (it becomes a shell word) prints why to stderr, after "<prefix>: ".
mini_user() {
  local file=${_mini_ssh_config:-/etc/ssh/ssh_config.d/mini.conf} line on= user=
  local -a words
  if [[ -r $file ]]; then
    for line in "${(@f)"$(<$file)"}"; do
      words=(${=line})
      [[ -z $words[1] || $words[1] == \#* ]] && continue
      case ${(L)words[1]} in
        host) on=; (( ${words[2,-1][(Ie)mini]} )) && on=1 ;;
        user) [[ -n $on ]] && { user=$words[2]; break; } ;;
      esac
    done
  fi
  if [[ $user =~ '^[a-z_][a-z0-9_-]*$' ]]; then
    print -r -- $user
  else
    print -u2 -r -- "${1:+$1: }cannot read the mini's account from $file"
    return 1
  fi
}
