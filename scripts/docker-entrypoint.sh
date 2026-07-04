#!/bin/sh
set -eu

CERT_SOURCE_DIR="${MAX_TRUSTED_CERTS_DIR:-/app/credentials}"
CERT_TARGET_DIR="/usr/local/share/ca-certificates/max"

find_cert() {
  for file_name in "$@"; do
    if [ -f "$CERT_SOURCE_DIR/$file_name" ]; then
      printf '%s\n' "$CERT_SOURCE_DIR/$file_name"
      return 0
    fi
  done

  return 1
}

install_cert() {
  source_file="$1"
  target_file="$2"

  mkdir -p "$CERT_TARGET_DIR"

  if grep -q -- '-----BEGIN CERTIFICATE-----' "$source_file" 2>/dev/null; then
    cp "$source_file" "$target_file"
  else
    openssl x509 -inform DER -in "$source_file" -out "$target_file"
  fi
}

needs_update=false

root_cert="$(find_cert \
  russian_trusted_root_ca.cer \
  russian_trusted_root_ca.crt \
  russian_trusted_root_ca.pem || true)"

sub_cert="$(find_cert \
  russian_trusted_sub_ca.cer \
  russian_trusted_sub_ca.crt \
  russian_trusted_sub_ca.pem || true)"

if [ -n "$root_cert" ]; then
  install_cert "$root_cert" "$CERT_TARGET_DIR/russian_trusted_root_ca.crt"
  needs_update=true
fi

if [ -n "$sub_cert" ]; then
  install_cert "$sub_cert" "$CERT_TARGET_DIR/russian_trusted_sub_ca.crt"
  needs_update=true
fi

if [ "$needs_update" = "true" ]; then
  update-ca-certificates
fi

if [ -z "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
fi

exec "$@"
