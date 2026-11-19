#!/usr/bin/env python3
"""Нічне озвучення власних слів учнів голосом Kokoro (2026-11-19, власник: «Так, роби»).
Бере з функції `tts-ingest` слова без запису, озвучує Kokoro (af_heart, як картки) і завантажує назад (WAV, 24 кГц, моно).
Запуск: TTS_INGEST_SECRET=... python3 scripts/tts-own-words.py /шлях/kokoro-v1.0.onnx /шлях/voices-v1.0.bin
Секрет — у Vault (`select decrypted_secret from vault.decrypted_secrets where name = 'tts_ingest_secret'`), у репозиторій не кладеться."""
import base64, importlib.util, io, json, os, sys, urllib.request

URL = 'https://uxqdklwnxdtyifksphoz.supabase.co/functions/v1/tts-ingest'
SECRET = os.environ['TTS_INGEST_SECRET']
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('kk', os.path.join(HERE, 'tts-kokoro.py'))
kk = importlib.util.module_from_spec(spec); spec.loader.exec_module(kk)

def call(method, body=None):
    req = urllib.request.Request(URL, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'x-ingest-secret': SECRET, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

def main(model, voices):
    words = call('GET')['words']
    print('pending', len(words))
    if not words: return
    import soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(model, voices)
    batch, done = [], 0
    for w in words:
        n = kk.norm(w)
        if not n: continue
        s, sr = k.create(n, voice='af_heart', speed=0.9 if len(n) < 25 else 0.95, lang='en-us')
        b = io.BytesIO(); sf.write(b, s, sr, format='WAV', subtype='PCM_16')
        batch.append({'text': w, 'wav': base64.b64encode(b.getvalue()).decode()})
        if len(batch) == 10:
            r = call('POST', {'items': batch}); done += r.get('ok', 0); batch = []
    if batch: done += call('POST', {'items': batch}).get('ok', 0)
    print('uploaded', done, 'of', len(words))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
