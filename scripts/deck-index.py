#!/usr/bin/env python3
"""Оновлює в data/decks/index.json кількість карток (count) і карток із прикладом (withEx).
Застосунок не вантажить усі колоди заради цих чисел (слово дня, лічильники). Викликається з scripts/bump.sh."""
import json, os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'decks')
path = os.path.join(root, 'index.json')
with open(path, encoding='utf-8') as f:
    src = f.read()
idx = json.loads(src)
for d in idx:
    with open(os.path.join(root, d['id'] + '.json'), encoding='utf-8') as f:
        cards = json.load(f)['cards']
    d['count'] = len(cards)
    d['withEx'] = sum(1 for c in cards if c.get('ex'))
out = json.dumps(idx, ensure_ascii=False, indent=1) + '\n'
if out != src:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('data/decks/index.json оновлено', file=sys.stderr)
