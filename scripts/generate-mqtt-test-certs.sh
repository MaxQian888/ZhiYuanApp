#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="${1:-${project_root}/build/mqtt-certs}"
temporary_directory="$(mktemp -d)"
store_password="changeit"

cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT
umask 077

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -sha256 \
  -subj "/CN=ZhiYuan MQTT Contract CA" \
  -keyout "${temporary_directory}/ca.key" \
  -out "${temporary_directory}/ca.crt"

issue_certificate() {
  local name="$1"
  local common_name="$2"
  local extensions="$3"
  local serial
  serial="$(openssl rand -hex 16)"

  openssl req -newkey rsa:2048 -nodes -sha256 \
    -subj "/CN=${common_name}" \
    -keyout "${temporary_directory}/${name}.key" \
    -out "${temporary_directory}/${name}.csr"
  openssl x509 -req -days 2 -sha256 \
    -in "${temporary_directory}/${name}.csr" \
    -CA "${temporary_directory}/ca.crt" \
    -CAkey "${temporary_directory}/ca.key" \
    -set_serial "0x${serial}" \
    -extfile <(printf '%b\n' "${extensions}") \
    -out "${temporary_directory}/${name}.crt"
}

issue_certificate "server" "localhost" \
  "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth"
issue_certificate "platform" "zhiyuan-platform" "extendedKeyUsage=clientAuth"
issue_certificate "uav-01" "UAV-01" "extendedKeyUsage=clientAuth"
issue_certificate "uav-02" "UAV-02" "extendedKeyUsage=clientAuth"

for identity in platform uav-01 uav-02; do
  openssl pkcs12 -export \
    -name "${identity}" \
    -inkey "${temporary_directory}/${identity}.key" \
    -in "${temporary_directory}/${identity}.crt" \
    -certfile "${temporary_directory}/ca.crt" \
    -passout "pass:${store_password}" \
    -out "${temporary_directory}/${identity}.p12"
done

openssl pkcs12 -export -nokeys \
  -name zhiyuan-contract-ca \
  -in "${temporary_directory}/ca.crt" \
  -passout "pass:${store_password}" \
  -out "${temporary_directory}/truststore.p12"

mkdir -p "${output_directory}"
for artifact in ca.crt server.crt server.key platform.p12 uav-01.p12 uav-02.p12 truststore.p12; do
  cp "${temporary_directory}/${artifact}" "${output_directory}/${artifact}"
done
chmod 600 "${output_directory}"/*.key "${output_directory}"/*.p12
printf 'Generated MQTT contract certificates in %s\n' "${output_directory}"
