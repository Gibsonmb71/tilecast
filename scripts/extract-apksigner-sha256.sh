#!/usr/bin/env bash
set -euo pipefail

# Read apksigner --print-certs output from stdin and emit the first signer
# certificate SHA-256 digest as 64 lowercase hexadecimal characters.
# Android Build Tools versions vary slightly in whitespace and punctuation,
# so normalize those differences instead of matching one exact output line.
awk '
  BEGIN { IGNORECASE = 1 }
  /Signer #[0-9]+ certificate SHA-256 digest:/ {
    line = $0
    sub(/^.*certificate SHA-256 digest:[[:space:]]*/, "", line)
    gsub(/[^0-9A-Fa-f]/, "", line)
    print tolower(line)
    exit
  }
'