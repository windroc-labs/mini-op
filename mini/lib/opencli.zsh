# OpenCLI's replies and page JS (FR-54, FR-58), for the mini's zsh scripts: the one parser of a
# reply's data, and the one way to build `opencli browser eval` code, from mini/js/page.

_opencli_pages=${${(%):-%x}:A:h:h}/js/page

# opencli_data: the data of the OpenCLI reply on stdin ({"ok":true,"data":…}), a string decoded,
# else as is; 1 and nothing printed when it has none (a failure) or a bad string.
opencli_data() {
  setopt localoptions extendedglob
  local reply rest out= c hex
  local -i i=1
  IFS= read -r -d '' reply
  [[ $reply == *'"data":'* ]] || return 1
  rest=${reply#*'"data":'}
  rest=${rest##[[:space:]]#}
  if [[ $rest != '"'* ]]; then
    rest=${rest%%[[:space:]]#}
    [[ $rest == *'}' ]] || return 1
    rest=${rest[1,-2]}
    print -r -- "${rest%%[[:space:]]#}"
    return 0
  fi
  while ((++i <= $#rest)); do
    c=$rest[i]
    if [[ $c == '"' ]]; then
      print -r -- "$out"
      return 0
    fi
    if [[ $c == '\' ]]; then
      c=$rest[++i]
      case $c in
        n) c=$'\n' ;;
        t) c=$'\t' ;;
        r) c=$'\r' ;;
        b) c=$'\b' ;;
        f) c=$'\f' ;;
        u)
          hex=$rest[i+1,i+4]
          [[ $hex == [[:xdigit:]](#c4) ]] || return 1
          printf -v c "\\u$hex"
          ((i += 4))
          ;;
        '"' | '\' | /) ;;
        *) return 1 ;;
      esac
    fi
    out+=$c
  done
  return 1
}

# json_str <s>: sets REPLY to <s> as a JSON string literal, < > & and control characters as \u
# escapes, so it is data in any page JS, even inside a <script>.
json_str() {
  local s=$1 c
  local -i i
  s=${s//'\'/'\\'}
  s=${s//'"'/'\"'}
  s=${s//'<'/'\u003c'}
  s=${s//'>'/'\u003e'}
  s=${s//'&'/'\u0026'}
  for i in {1..31}; do
    c=${(#)i}
    [[ $s == *$c* ]] && s=${s//$c/'\u00'${(l:2::0:)$(([##16] i))}}
  done
  REPLY=\"$s\"
}

# page_js <name> [args...]: the code for `o eval`: page program mini/js/page/<name>.js called with
# each arg as a JSON string, so no arg is ever code.
page_js() {
  setopt localoptions extendedglob
  local name=$1 code arg
  local -a args
  if [[ $name != [a-z]## || ! -r $_opencli_pages/$name.js ]]; then
    print -u2 -r -- "page_js: no page program $_opencli_pages/$name.js"
    return 1
  fi
  code=$(<$_opencli_pages/$name.js)
  shift
  for arg; do
    json_str "$arg"
    args+=("$REPLY")
  done
  print -r -- "${code#*$'\n'}(${(j:,:)args})"
}
