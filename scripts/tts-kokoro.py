#!/usr/bin/env python3
"""Озвучення постійного змісту голосом Kokoro (Apache-2.0) — 2026-11-19, власник: «найжахливіший голос у картках».
Безкоштовний ліміт Gemini TTS (~30 записів/добу на всіх) не покриває картки, тож слова карток, речення диктанту, фрази вимови
й діалоги аудіювання озвучуються наперед і лежать на сайті: audio/<us|uk>/<ключ>.m4a + audio/index.json.
Ключ — FNV-1a 32 від нормалізованого тексту в нижньому регістрі + довжина (так само рахує js/speech.js → staticKey()).
Запуск: python3 scripts/tts-kokoro.py /шлях/до/kokoro-v1.0.onnx /шлях/до/voices-v1.0.bin  (моделі — github.com/thewh1teagle/kokoro-onnx, реліз model-files-v1.0)
Повторний запуск озвучує лише нове."""
import glob, json, os, re, subprocess, sys, tempfile
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'audio')
VOICE = {'us': ('af_heart', 'en-us'), 'uk': ('bf_emma', 'en-gb')}
DLG = {'us': {'f': ['af_heart', 'af_bella'], 'm': ['am_michael', 'am_fenrir']}, 'uk': {'f': ['bf_emma', 'bf_isabella'], 'm': ['bm_george', 'bm_lewis']}}
FEMALE = re.compile(r'^(mrs|ms|miss|woman|girl|anna|emma|ewa|kasia|kate|sophie|olga|maria|marta|julia|lucy|sarah|alice|vita|tetiana|natalia|ola|zosia)\b', re.I)
MALE = re.compile(r'^(mr|man|boy|oliver|tom|marek|john|james|jack|david|peter|piotr|adam|max|sam|paul|mark|taras|ivan)\b', re.I)

def norm(t):
    t = re.sub(r'\([^)]*\)', ' ', str(t))
    t = re.sub(r'\s*/\s*', ', ', t)
    t = re.sub(r'\s+', ' ', t).strip().strip(',').strip()
    return t

def key(t):
    s = norm(t).lower()
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b; h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}{len(s):x}'

def genders(names):
    g = ['f' if FEMALE.search(n or '') else 'm' if MALE.search(n or '') else '' for n in (names + ['', ''])[:2]]
    if not g[0] and not g[1]: g = ['f', 'm']
    elif not g[0]: g[0] = 'f' if g[1] == 'm' else 'm'
    elif not g[1]: g[1] = 'f' if g[0] == 'm' else 'm'
    return g

def collect():
    items = {}
    def add(t, slow=False):
        n = norm(t)
        if n and re.search(r'[A-Za-z]', n) and len(n) <= 400: items.setdefault(key(t), (n, 0.9 if len(n) < 25 else 0.95))
    for f in glob.glob(os.path.join(ROOT, 'data/decks/*.json')):
        if f.endswith('index.json'): continue
        d = json.load(open(f)); cards = d['cards'] if isinstance(d, dict) else d
        for c in cards: add(c['en'])
    L = json.load(open(os.path.join(ROOT, 'data/listening.json')))
    for it in L['dictation']: add(it['text'])
    P = json.load(open(os.path.join(ROOT, 'data/pronunciation.json')))
    for it in P.get('shadowing', []): add(it['en'])
    for it in P.get('pairs', []): add(it['a']); add(it['b'])
    for it in P.get('sounds', []):
        for w in it.get('words', []): add(w)
        if it.get('sentence'): add(it['sentence'])
    dlgs = []
    for d in L['dialogues']:
        lines = [l['text'] for l in d['lines']]
        dk = 'd' + key('\n'.join(lines))
        dlgs.append((dk, d.get('speakers') or [], [(1 if l.get('speaker') else 0, norm(l['text'])) for l in d['lines']]))
    return items, dlgs

K = None
def init(model, voices):
    global K
    from kokoro_onnx import Kokoro
    K = Kokoro(model, voices)

def enc(samples, sr, path):
    import soundfile as sf
    with tempfile.NamedTemporaryFile(suffix='.wav') as w:
        sf.write(w.name, samples, sr)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', w.name, '-ac', '1', '-c:a', 'aac', '-b:a', '40k', '-movflags', '+faststart', path], check=True)

def job_item(a):
    acc, k, text, speed = a
    path = os.path.join(OUT, acc, k + '.m4a')
    if os.path.exists(path): return None
    v, lang = VOICE[acc]
    s, sr = K.create(text, voice=v, speed=speed, lang=lang)
    enc(s, sr, path)
    return k

def job_dlg(a):
    import numpy as np
    acc, dk, names, lines = a
    path = os.path.join(OUT, acc, dk + '.m4a')
    g = genders(list(names))
    vv = DLG[acc]
    voices = [vv[g[0]][0], vv[g[1]][0] if g[1] != g[0] else vv[g[1]][1]]
    lang = VOICE[acc][1]
    parts, offs, t, sr = [], [], 0.0, 24000
    for sp, text in lines:
        s, sr = K.create(text, voice=voices[sp], speed=0.92, lang=lang)
        offs.append(round(t, 2)); gap = np.zeros(int(sr * 0.5), dtype=s.dtype)
        parts += [s, gap]; t += (len(s) + len(gap)) / sr
    if not os.path.exists(path): enc(np.concatenate(parts), sr, path)
    return dk, acc, offs

def write_index(items, offsets=None):
    """audio/index.json: { keys: { us: [...], uk: [...] }, dlg: { ключ: { us: [початки реплік], uk: [...] } } } — лише наявні файли"""
    path = os.path.join(OUT, 'index.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    keys = {a: sorted(k for k in items if os.path.exists(os.path.join(OUT, a, k + '.m4a'))) for a in VOICE}
    dlg = {**(old.get('dlg') or {}), **(offsets or {})}
    json.dump({'v': 2, 'keys': keys, 'dlg': dlg}, open(path, 'w'), separators=(',', ':'))
    print('index', {a: len(v) for a, v in keys.items()}, len(dlg), 'dialogues')

if __name__ == '__main__':
    if sys.argv[1:] == ['--index']:
        write_index(collect()[0]); sys.exit()
    model, voices = sys.argv[1], sys.argv[2]
    items, dlgs = collect()
    for acc in VOICE: os.makedirs(os.path.join(OUT, acc), exist_ok=True)
    tasks = [(acc, k, t, sp) for acc in VOICE for k, (t, sp) in items.items()]
    dtasks = [(acc, dk, names, lines) for acc in VOICE for dk, names, lines in dlgs]
    with Pool(int(os.environ.get('JOBS', '4')), initializer=init, initargs=(model, voices)) as p:
        done = 0
        for r in p.imap_unordered(job_item, tasks, chunksize=8):
            done += 1
            if done % 500 == 0: print('items', done, '/', len(tasks), flush=True)
        offsets = {}
        for dk, acc, offs in p.imap_unordered(job_dlg, dtasks):
            offsets.setdefault(dk, {})[acc] = offs
    write_index(items, offsets)
