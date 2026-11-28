// Вчитель — лише для англійської (2026-11-28, власник: «захист, щоб не використовували ШІ як безкоштовний варіант для своїх цілей»).
// Дешеве розпізнавання без AI: код, «напиши за мене» (есе, код, резюме, бізнес-план…), розв'язання задач, довгі вставлені тексти.
// Не відмова з порогу (можливі хибні спрацювання) — сервер додає до промпту жорстке нагадування і, понад денну межу, різко обмежує довжину відповіді.

const CODE = /```|<\/?(div|script|html|body|span|table)\b|\b(def|function|class|import|public static|#include|console\.log|SELECT .* FROM|CREATE TABLE)\b[^\n]{0,80}[({;=:]/i;
const MAKE = /\b(write|generate|create|make|draft|compose|code|build|give me|do)\b[^.?!\n]{0,40}\b(code|script|program|app|website|function|sql|query|regex|macro|formula|essay|thesis|coursework|dissertation|article|blog post|cv|resume|cover letter|business plan|marketing|contract|report|presentation|homework|seo|post for (?:instagram|facebook|linkedin|tiktok))\b/i;
const MAKE_SLAV = /(напиши|напишіть|згенеруй|створи|склади|зроби|сделай|создай|составь|napisz|stwórz|zrób|escribe|genera|crea|escreva|gere|crie|yaz|oluştur)[^.?!\n]{0,50}(код|програм|скрипт|сайт|функці|функци|sql|есе|эссе|реферат|курсов|диплом|дисертац|статт|стать|резюме|cv|бізнес-план|бизнес-план|супровідн|сопроводит|звіт|отчет|отчёт|презентац|договір|договор|kod|program|esej|wypracowanie|artykuł|biznesplan|ensayo|código|artículo|ensaio|artigo|kod|makale|ödev)/i;
const SOLVE = /\b(solve|calculate|integral|derivative|prove that)\b|(розв'?яж|розвʼяж|реши|решить|policz|rozwiąż|resuelve|resolva|çöz)[^.?!\n]{0,30}(задач|рівнян|уравнен|приклад|zadani|równan|ecuaci|equaç|problem|denklem)|\d+\s*[-+*/^]\s*\d+\s*=\s*\?/i;

/** Ознака запиту не про вивчення англійської (повертає причину або '') */
export function offTopic(text: string): string {
  const t = String(text || '');
  if (!t.trim()) return '';
  if (CODE.test(t)) return 'code';
  if (MAKE.test(t) || MAKE_SLAV.test(t)) return 'make';
  if (SOLVE.test(t)) return 'solve';
  if (t.length > 1800) return 'paste';
  return '';
}

/** Додаток до системного промпту, коли останнє повідомлення схоже на запит не за призначенням */
export function scopeGuard(reason: string, strict: boolean) {
  const what = reason === 'code' ? 'code or a technical task' : reason === 'solve' ? 'solving a task from another subject' : reason === 'paste' ? 'a long pasted text' : 'a ready-made text or product made for them';
  return `
SCOPE GUARD (server notice, not the student's words): the student's last message looks like a request for ${what}, not English practice.
- Do NOT produce it: no code, no finished essays, CVs, letters, posts, plans or reports to hand in, no solutions in other subjects, no translation or rewrite of long documents.
- In 1–2 sentences say kindly that you are their English tutor, then turn it into English practice (e.g. help them describe it in English, give 3 useful phrases, or check THEIR OWN draft in English).${reason === 'paste' ? ' For a long pasted text: work only with 2–3 sentences of it as English learning material (vocabulary, grammar), never translate or rewrite all of it.' : ''}
- If the message is really just about their life (e.g. "I have to write a report at work today") or a question about English, ignore this notice and continue normally.
${strict ? '- The student has done this several times today: answer in at most 3 short sentences and return to the lesson.\n' : ''}`;
}
