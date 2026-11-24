// Мова й регіон учня в промптах (2026-11-24: застосунок багатомовний)
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { langOf, uiOf, readUiLang, readAbout, isUiText, regionOf, regionRule, inUiLang, langStyle, UK_STYLE, explainIn, modePrompt, learnerOf, nativeWordRule, type Student } from './prompts.ts';
import { groupLang, replyPrompt } from './grouptutor.ts';
import { hwPrompt, HW_PROMPT, cleanHw, fallbackNote } from './homework.ts';

const st = (o: Partial<Student> = {}): Student => ({
  level: 'B1', tutorName: 'Alex', tutorTone: 'friendly', explainLang: 'uk', strictness: 'important', voice: 'Puck', workFocus: false,
  weak: [], words: [], lastFocus: null, about: readAbout({}, o.uiLang), memory: [], recent: [], history: [], focus: [], disputes: [], open: [], voicePauseMs: 1700, ...o,
});

Deno.test('langOf / uiOf: explanation language from settings.lang and explainLang', () => {
  assertEquals(langOf({}), 'Ukrainian');
  assertEquals(langOf({ explainLang: 'en' }), 'simple English');
  assertEquals(langOf({ explainLang: 'mix' }), 'Ukrainian with key terms in English');
  assertEquals(langOf({ uiLang: 'es' }), 'Spanish');
  assertEquals(langOf({ uiLang: 'pt', explainLang: 'mix' }), 'Portuguese (Brazil) with key terms in English');
  assertEquals(langOf({ uiLang: 'ru', explainLang: 'en' }), 'simple English');
  assertEquals(uiOf({ uiLang: 'tr', explainLang: 'en' }), 'Turkish');
  assertEquals(readUiLang('xx'), 'uk');
  assertEquals(readUiLang(undefined), 'uk');
  assertEquals(explainIn(st({ level: 'A0', uiLang: 'pl' })), 'simple Polish');
});

Deno.test('readAbout: empty nativeLang = UI language; typed names mapped', () => {
  assertEquals(readAbout({}).nativeLang, 'Ukrainian');
  assertEquals(readAbout({}, 'es').nativeLang, 'Spanish');
  assertEquals(readAbout({}, 'pt').nativeLang, 'Portuguese');
  assertEquals(readAbout({ nativeLang: 'русский' }, 'ru').nativeLang, 'Russian');
  assertEquals(readAbout({ nativeLang: 'українська' }, 'ru').nativeLang, 'Ukrainian');
});

Deno.test('region: city from profile wins; ru = Ukraine, never Russia', () => {
  assertEquals(regionOf({ uiLang: 'pt' }), 'Brazil');
  assertEquals(regionOf({ uiLang: 'es', about: { location: 'Sevilla' } }), 'Sevilla');
  const ru = regionRule({ uiLang: 'ru' });
  assert(ru.includes('Ukraine') && ru.includes('never Russia') && ru.includes('never politics or war'));
  assert(regionRule({ uiLang: 'tr' }).includes('Turkey'));
  assert(regionRule({ uiLang: 'pl', about: { location: 'Kraków' } }).includes('Kraków'));
});

Deno.test('isUiText: script / not English', () => {
  assert(isUiText('кіт', 'uk') && isUiText('кот', 'ru') && !isUiText('cat', 'uk'));
  assert(isUiText('gato', 'es', 'cat') && !isUiText('cat', 'es', 'cat') && !isUiText('кот', 'es'));
});

Deno.test('langStyle / inUiLang: Ukrainian unchanged, others switched', () => {
  assertEquals(langStyle('uk'), UK_STYLE);
  const ru = langStyle('ru');
  assert(ru.includes('«в Украине»') && ru.includes('never refer to Russia') && !ru.includes('Never answer in Russian'));
  assert(langStyle('es').includes('«tú»') && langStyle('pt').includes('«você»') && langStyle('tr').includes('«siz»') && langStyle('pl').includes('«ty»'));
  assertEquals(inUiLang('in Ukrainian («ви»)', 'uk'), 'in Ukrainian («ви»)');
  assert(inUiLang('in Ukrainian («ви»)', 'es').startsWith('in Spanish («tú»)'));
  assert(inUiLang('Address the learner formally («ви»).', 'pl').startsWith('Address the learner with «ty».'));
  assertEquals(learnerOf('uk'), 'Ukrainian learner');
  assertEquals(nativeWordRule('uk'), 'If they say a Ukrainian word, write it in Ukrainian Cyrillic.');
  assert(nativeWordRule('es').includes('Spanish'));
});

Deno.test('modePrompt: Spanish student gets Spanish explanations, no Ukrainian-only rules', () => {
  const es = st({ uiLang: 'es', level: 'A1' });
  const p = modePrompt('chat', es, {});
  assert(p.includes('always in Spanish') && p.includes('Spain and Latin America'));
  assert(!p.includes('very short Ukrainian hint') && !p.includes('коротке пояснення українською'));
  assert(p.includes('Never write Russian.'));
  const ru = modePrompt('chat', st({ uiLang: 'ru' }), {});
  assert(!ru.includes('Never write Russian.') && ru.includes('calques'));   // ru: кальки як в українців
  const tr = modePrompt('chat', st({ uiLang: 'tr' }), {});
  assert(tr.includes('false friends and calques from Turkish') && !tr.includes('depend of'));
});

Deno.test('groupLang: dominant language (2/3) or English only', () => {
  assertEquals(groupLang(['uk', 'uk', undefined]), 'uk');
  assertEquals(groupLang(['es', 'es', 'es', 'uk']), 'es');
  assertEquals(groupLang(['es', 'uk']), 'en');
  assertEquals(groupLang(['es', 'uk', 'pl']), 'en');
  assert(replyPrompt('A1', false, 'uk').includes('short Ukrainian translation in brackets'));
  assert(replyPrompt('A1', false, 'es').includes('short Spanish translation in brackets'));
  const mixed = replyPrompt('A1', false, 'en');
  assert(mixed.includes('English only') && !mixed.includes('translation in brackets'));
});

Deno.test('homework: prompt and check in the student language', () => {
  assertEquals(hwPrompt('uk'), HW_PROMPT);
  const es = hwPrompt('es');
  assert(es.includes('in natural modern Spanish') && es.includes('translated into Spanish') && es.includes('focus in Spanish') && !es.includes('literary Ukrainian'));
  const ok = cleanHw({ note_uk: 'Esta semana: Past Simple.', prompt_en: 'Write 60 words about your weekend.', prompt_uk: 'Escribe 60 palabras.', focus_uk: '' }, 'es');
  assertEquals(ok?.prompt_uk, 'Escribe 60 palabras.');
  assertEquals(cleanHw({ note_uk: 'Write about it', prompt_en: 'Write about it', prompt_uk: '', focus_uk: '' }, 'es'), null);
  assert(fallbackNote({ lang: 'pl' }, null).startsWith('W tym tygodniu'));
  assert(fallbackNote({}, null).startsWith('Цього тижня'));
});
