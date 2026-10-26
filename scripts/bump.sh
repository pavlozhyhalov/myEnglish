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
{
  echo "// Згенеровано scripts/bump.sh — не редагувати вручну"
  echo "self.PRECACHE = ["
  echo "  './', './index.html', './manifest.webmanifest',"
  find css js data assets fonts vendor -type f \( -name '*.css' -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.png' -o -name '*.woff2' \) | sort | sed "s#^#  './#; s#\$#',#"
  echo "];"
} > precache-list.js
echo "BUILD $OLD → $NEW"
