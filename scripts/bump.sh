#!/usr/bin/env bash
# Піднімає BUILD у js/config.js, sw.js, index.html (?v=) і перегенеровує precache-list.js.
set -euo pipefail
cd "$(dirname "$0")/.."
NEW="${1:-$(date +%Y%m%d%H%M%S)}"
OLD=$(grep -oE "BUILD = '[0-9]{12,14}'" js/config.js | grep -oE '[0-9]{12,14}')
# той самий BUILD = байт-у-байт той самий sw.js — браузер не встановить оновлення
if [ "$NEW" = "$OLD" ]; then echo "BUILD не змінився ($OLD) — зачекайте секунду" >&2; exit 1; fi
sed -i "s/BUILD = '$OLD'/BUILD = '$NEW'/" js/config.js sw.js
sed -i "s/?v=$OLD/?v=$NEW/g" index.html
# лічильники карток у каталозі колод (застосунок не вантажить усі колоди заради них)
if command -v python3 >/dev/null; then python3 scripts/deck-index.py; else echo "python3 немає — count/withEx у data/decks/index.json не перевірено" >&2; fi
# шлях → перші 12 символів sha256 вмісту: SW копіює незмінені файли з попереднього кешу, а не качає знову
h12() { sha256sum "$1" | cut -c1-12; }
{
  echo "// Згенеровано scripts/bump.sh — не редагувати вручну"
  echo "// шлях → хеш вмісту (sha256, 12 символів)"
  echo "self.PRECACHE = {"
  echo "  './': '$(h12 index.html)', './index.html': '$(h12 index.html)', './manifest.webmanifest': '$(h12 manifest.webmanifest)',"
  find css js data assets fonts vendor -type f \( -name '*.css' -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.png' -o -name '*.woff2' \) -print0 \
    | sort -z | xargs -0 sha256sum | awk '{ printf "  '"'"'./%s'"'"': '"'"'%s'"'"',\n", $2, substr($1, 1, 12) }'
  echo "};"
} > precache-list.js
echo "BUILD $OLD → $NEW"
