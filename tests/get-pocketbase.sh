#!/usr/bin/env bash
# Скачивает PocketBase для автотестов на своём сервере (CRM_DB=pb) в tests/.pb/ с проверкой контрольной суммы.
set -euo pipefail
VER="${PB_VERSION:-0.40.6}"
cd "$(dirname "$0")"
[ -x .pb/pocketbase ] && .pb/pocketbase --version | grep -q " $VER\$" && exit 0
case "$(uname -s)-$(uname -m)" in Linux-x86_64) P=linux_amd64;; Linux-aarch64) P=linux_arm64;; Darwin-arm64) P=darwin_arm64;; Darwin-x86_64) P=darwin_amd64;; *) echo "неизвестная система"; exit 1;; esac
Z="pocketbase_${VER}_${P}.zip"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
curl -fsSL -o "$T/$Z" "https://github.com/pocketbase/pocketbase/releases/download/v$VER/$Z"
curl -fsSL -o "$T/checksums.txt" "https://github.com/pocketbase/pocketbase/releases/download/v$VER/checksums.txt"
(cd "$T" && grep " ${Z}\$" checksums.txt | (command -v sha256sum >/dev/null && sha256sum -c - || shasum -a 256 -c -))
mkdir -p .pb && unzip -o -q "$T/$Z" pocketbase -d .pb && chmod +x .pb/pocketbase && .pb/pocketbase --version
