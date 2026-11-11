#!/usr/bin/env bash
# Піднімає BUILD у js/config.js, sw.js, index.html (?v=) і перегенеровує precache-list.js.
set -euo pipefail
cd "$(dirname "$0")/.."

# <link rel="modulepreload"> для статичного графа модулів старту (js/app.js) і головної (js/pages/home.js):
# браузер качає весь граф однією хвилею, а не рівень за рівнем (app → daily → srs → ts-fsrs …).
# Адреси без ?v= — так само, як їх імпортує app.js (інакше модуль качався б двічі). Блок між маркерами в index.html.
modulepreload() {
  python3 - <<'PY'
import re, os, posixpath
IMP = re.compile(r"""^\s*(?:import|export)\s[^;()]*?\sfrom\s*['"](\.{1,2}/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}/[^'"]+)['"]""", re.M)
def deps(f):
    src = open(f, encoding='utf-8').read()
    return [posixpath.normpath(posixpath.join(posixpath.dirname(f), a or b)) for a, b in IMP.findall(src)]
def closure(entry):
    seen, order, q = {entry}, [], [entry]
    while q:
        f = q.pop(0); order.append(f)
        for d in deps(f):
            if d not in seen and os.path.isfile(d): seen.add(d); q.append(d)
    return order
start = closure('js/app.js')[1:]          # app.js уже має свій modulepreload з ?v=
home = [f for f in closure('js/pages/home.js') if f not in start and f != 'js/app.js']
links = ''.join(f'<link rel="modulepreload" href="{f}">\n' for f in start + home)
html = open('index.html', encoding='utf-8').read()
a, b = '<!-- modulepreload:start -->\n', '<!-- modulepreload:end -->'
if a not in html or b not in html: raise SystemExit('index.html: немає маркерів modulepreload')
i, j = html.index(a) + len(a), html.index(b)
open('index.html', 'w', encoding='utf-8').write(html[:i] + links + html[j:])
print(f'modulepreload: {len(start)} модулів старту + {len(home)} головної')
PY
}
if [ "${1:-}" = "--preload" ]; then modulepreload; exit 0; fi

NEW="${1:-$(date +%Y%m%d%H%M%S)}"
OLD=$(grep -oE "BUILD = '[0-9]{12,14}'" js/config.js | grep -oE '[0-9]{12,14}')
# той самий BUILD = байт-у-байт той самий sw.js — браузер не встановить оновлення
if [ "$NEW" = "$OLD" ]; then echo "BUILD не змінився ($OLD) — зачекайте секунду" >&2; exit 1; fi
sed -i "s/BUILD = '$OLD'/BUILD = '$NEW'/" js/config.js sw.js
sed -i "s/?v=$OLD/?v=$NEW/g" index.html
if command -v python3 >/dev/null; then modulepreload; else echo "python3 немає — modulepreload в index.html не оновлено" >&2; fi
# лічильники карток у каталозі колод (застосунок не вантажить усі колоди заради них)
if command -v python3 >/dev/null; then python3 scripts/deck-index.py; else echo "python3 немає — count/withEx у data/decks/index.json не перевірено" >&2; fi
# шлях → перші 12 символів sha256 вмісту: SW копіює незмінені файли з попереднього кешу, а не качає знову
h12() { sha256sum "$1" | cut -c1-12; }
{
  echo "// Згенеровано scripts/bump.sh — не редагувати вручну"
  echo "// шлях → хеш вмісту (sha256, 12 символів)"
  echo "self.PRECACHE = {"
  echo "  './': '$(h12 index.html)', './index.html': '$(h12 index.html)', './manifest.webmanifest': '$(h12 manifest.webmanifest)',"
  find css js data assets fonts vendor -type f -not -path 'vendor/pdf/*' -not -path 'data/books/*/*' \( -name '*.css' -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.png' -o -name '*.woff2' \) -print0 \
    | sort -z | xargs -0 sha256sum | awk '{ printf "  '"'"'./%s'"'"': '"'"'%s'"'"',\n", $2, substr($1, 1, 12) }'
  echo "};"
} > precache-list.js
echo "BUILD $OLD → $NEW"
