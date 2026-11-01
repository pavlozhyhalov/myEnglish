// Довідник граматичних правил для групування помилок учня-українця (дзеркало js/rules.js — підписи українською).
// Модель обирає id правила для кожної помилки; засвоєння й прогрес рахуються по правилу, а не по окремому реченню.
export const RULES: Record<string, { uk: string; type: string; en: string }> = {
  'articles-a': { uk: 'Артикль a/an', type: 'articles', en: 'missing or wrong a/an' },
  'articles-the': { uk: 'Артикль the', type: 'articles', en: 'missing or wrong the' },
  'articles-extra': { uk: 'Зайвий артикль', type: 'articles', en: 'article where none is needed' },
  'third-person-s': { uk: 'Закінчення -s у 3-й особі', type: 'tenses', en: 'he/she/it + verb-s in Present Simple' },
  'be-auxiliary': { uk: 'Пропущене am/is/are/was/were', type: 'tenses', en: 'missing or wrong form of be (I am, we were, I\'m feeling)' },
  'continuous': { uk: 'Тривалі часи (be + -ing)', type: 'tenses', en: 'continuous form or use' },
  'stative-verbs': { uk: 'Дієслова стану без -ing', type: 'tenses', en: 'state verbs in continuous (I am knowing)' },
  'past-simple': { uk: 'Минулий простий час', type: 'tenses', en: 'Past Simple needed (finished past action)' },
  'irregular-verbs': { uk: 'Неправильні дієслова', type: 'tenses', en: 'irregular verb forms (buyed, have went)' },
  'perfect-vs-past': { uk: 'Present Perfect чи Past Simple', type: 'tenses', en: 'Present Perfect vs Past Simple (experience, yesterday)' },
  'perfect-duration': { uk: 'Тривалість: for/since + Present Perfect', type: 'tenses', en: 'I live here since → I have lived here for/since' },
  'future-plans': { uk: 'Майбутнє: плани й домовленості', type: 'tenses', en: 'next week I go → I am going / going to' },
  'future-will': { uk: 'Майбутнє з will', type: 'tenses', en: 'will future, predictions, decisions' },
  'conditionals': { uk: 'Умовні речення', type: 'tenses', en: 'if-clauses' },
  'modals': { uk: 'Модальні дієслова', type: 'other', en: 'must to, can to, should + base verb' },
  'infinitive-to': { uk: 'Інфінітив з to', type: 'other', en: 'want see → want to see; make him to do' },
  'gerund-infinitive': { uk: '-ing чи to після дієслова', type: 'other', en: 'enjoy to swim → enjoy swimming' },
  'questions': { uk: 'Питання: допоміжне дієслово й порядок', type: 'word_order', en: 'Where you live? → Where do you live?' },
  'negation': { uk: 'Заперечення', type: 'other', en: "don't/doesn't/didn't, double negatives" },
  'word-order': { uk: 'Порядок слів', type: 'word_order', en: 'word order in statements, adverb position' },
  'prep-time': { uk: 'Прийменники часу', type: 'prepositions', en: 'in/on/at with time, in this time' },
  'prep-place': { uk: 'Прийменники місця й руху', type: 'prepositions', en: 'in/on/at/to with places, arrive to' },
  'prep-dependent': { uk: 'Прийменник після слова', type: 'prepositions', en: 'depend of, listen music, married with' },
  'countable': { uk: 'Злічувані й незлічувані', type: 'vocabulary', en: 'informations, advices, much/many' },
  'plurals': { uk: 'Множина', type: 'other', en: 'plural forms and agreement' },
  'pronouns': { uk: 'Займенники', type: 'other', en: 'pronoun forms and reference' },
  'comparatives': { uk: 'Ступені порівняння', type: 'other', en: 'more better, than/as' },
  'agreement': { uk: 'Узгодження підмета й дієслова', type: 'tenses', en: 'we was, people is, my wife say' },
  'collocations': { uk: 'Сталі сполучення', type: 'vocabulary', en: 'make photos → take photos, do a mistake' },
  'word-choice': { uk: 'Вибір слова й кальки', type: 'vocabulary', en: 'wrong word or calque from Ukrainian' },
  'passive-reported': { uk: 'Пасив і непряма мова', type: 'tenses', en: 'passive voice, reported speech, sequence of tenses' },
  'other': { uk: 'Інше', type: 'other', en: 'anything else' },
};
export const RULE_IDS = Object.keys(RULES);
/** Список для промпту: «id — опис» */
export const RULES_PROMPT = RULE_IDS.map(id => `${id} — ${RULES[id].en}`).join('; ');
export const ruleOf = (v: unknown) => (typeof v === 'string' && v in RULES ? v : 'other');
export const typeOfRule = (rule: string, fallback = 'other') => (rule !== 'other' ? RULES[rule]?.type : null) || fallback;

// ---------- Порівняння фрагментів (виправлення, оскарження) ----------
export const normFrag = (s: unknown) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
export type Dispute = { wrong: string; right: string };
/** Учень оскаржив таке виправлення раніше — не показувати знову */
export function isDisputed(f: { wrong?: unknown; right?: unknown }, disputes: Dispute[]) {
  const w = normFrag(f.wrong), r = normFrag(f.right);
  if (!w) return false;
  return disputes.some(d => { const dw = normFrag(d.wrong), dr = normFrag(d.right); return dw && (w === dw || (w.includes(dw) && (!dr || r.includes(dr)))); });
}
