# pack_tar <tar args>: tar with no extended attributes or macOS metadata (AppleDouble ._ files), on
# bsdtar (macOS) and GNU tar alike. Sourced by ctl/mini and ctl/runbook.
pack_tar() {
  local -a flags=(--no-xattrs)
  [[ $(tar --version) == *bsdtar* ]] && flags+=(--no-mac-metadata)
  COPYFILE_DISABLE=1 tar $flags "$@"
}
