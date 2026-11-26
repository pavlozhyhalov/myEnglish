#!/usr/bin/env bash
# Копія сайту в пакет застосунку iOS (native/www) + cap sync. Записи озвучення (*.m4a, ~140 МБ) не копіюються —
# застосунок бере їх із сайту (js/native.js → remote()). Запуск з кореня репозиторію або з native/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/native/www"
rm -rf "$WWW" && mkdir -p "$WWW"
cd "$ROOT"
tar --exclude='./native' --exclude='./scripts' --exclude='./supabase' --exclude='./docs' --exclude='./s3' --exclude='./.git' --exclude='./.github' \
    --exclude='./.claude' --exclude='./node_modules' --exclude='*.m4a' --exclude='*.md' --exclude='./sw.js' --exclude='./precache-list.js' -cf - . | tar -xf - -C "$WWW"
echo "www: $(du -sh "$WWW" | cut -f1)"
cd "$ROOT/native" && npx cap sync ios
