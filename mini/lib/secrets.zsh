# The one home of the secret patterns (FR-34): termwait hides them, shot refuses them, storekey
# checks a key with them, .github/image-check scans image history for them. Sourced by zsh and by
# bash, so it keeps to what both run. EREs, for awk on macOS and Linux; callers pick by key.
# The three arrays stay index-aligned: key, display name and pattern of each secret.
SECRET_KEYS=(anthropic linear github github-pat private-key)
SECRET_NAMES=(sk-ant- lin_api_ 'gh[pousr]_' github_pat_ 'private key')
SECRET_RES=('sk-ant-[A-Za-z0-9_-]+' 'lin_api_[A-Za-z0-9_]+' 'gh[pousr]_[A-Za-z0-9_]+'
  'github_pat_[A-Za-z0-9_]+' '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----')

# _secrets_re [<key>...]: the chosen patterns (default: all) as one ERE; 2 for an unknown key.
_secrets_re() {
  local key k i re out=
  [ $# -gt 0 ] || set -- "${SECRET_KEYS[@]}"
  for key in "$@"; do
    i=0 re=
    for k in "${SECRET_KEYS[@]}"; do
      [ "$k" = "$key" ] && re="${SECRET_RES[@]:$i:1}"
      i=$((i + 1))
    done
    [ -n "$re" ] || return 2
    out="${out:+$out|}$re"
  done
  printf '%s\n' "$out"
}

# secrets_found [<key>...]: 0 when stdin holds a match of any (or the named) pattern, else 1.
# It reads all of stdin, so the writer never dies of SIGPIPE.
secrets_found() {
  local re
  re=$(_secrets_re "$@") || return 2
  awk -v re="$re" '$0 ~ re { found = 1 } END { exit !found }'
}

# secret_is <key>: 0 when stdin, less one trailing newline, is exactly one whole token of <key>.
secret_is() {
  local re
  [ $# -eq 1 ] && [ "$1" != private-key ] || return 2
  re=$(_secrets_re "$1") || return 2
  awk -v re="^($re)\$" 'NR == 1 && $0 ~ re { ok = 1 } END { exit !(ok && NR == 1) }'
}

# secrets_redact: stdin to stdout with each token as <redacted>, each private key block (BEGIN
# line to END line, or to the end; for an END whose BEGIN scrolled off, all before it) as one
# line, and the lines of Claude's OAuth token block (a wrapped token has no prefix on its next
# line; for a Store line whose heading scrolled off, all before it) as one "<token hidden>".
secrets_redact() {
  local begin
  begin=$(_secrets_re private-key)
  awk -v tokens="$(_secrets_re anthropic linear github github-pat)" -v begin="$begin" \
    -v end="${begin/BEGIN/END}" '
    function emit(line) { out[++n] = line }
    oauth && /Store this token/ { oauth = 0 }
    !heading && /Store this token/ { n = 0; emit("  <token hidden>") }
    oauth { next }
    key { if ($0 ~ end) key = 0; next }
    $0 ~ begin { emit("<redacted private key>"); key = 1; next }
    $0 ~ end { n = 0; emit("<redacted private key>"); next }
    { gsub(tokens, "<redacted>"); emit($0) }
    /Your OAuth token/ { emit("  <token hidden>"); oauth = heading = 1 }
    END { for (i = 1; i <= n; i++) print out[i] }'
}
