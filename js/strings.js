// Усі рядки інтерфейсу. Одна мова — українська.

// Мікрофон: підказка, де саме дозволити, — під платформу (2026-11-14, «з Android мікрофон не вмикається»)
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
/** Вбудований браузер месенджера чи соцмережі (WebView) — мікрофон там зазвичай недоступний */
export function inApp() { return /FBAN|FBAV|Instagram|Viber|Line\/|MicroMessenger|; wv\)|Snapchat|TikTok/i.test(UA); }
function micHelp() {
  if (inApp()) return 'Цей вбудований браузер не дає доступу до мікрофона. Відкрийте сайт у Chrome або Safari: меню ⋮ → «Відкрити в браузері».';
  if (/Android/i.test(UA)) return /SamsungBrowser/i.test(UA)
    ? 'Немає доступу до мікрофона. Samsung Internet: ☰ → Налаштування → Сайти й завантаження → Дозволи сайтів → Мікрофон. Або Налаштування телефону → Програми → Samsung Internet → Дозволи → Мікрофон.'
    : 'Немає доступу до мікрофона. Торкніться значка ліворуч від адреси сайту → Дозволи → Мікрофон → Дозволити. Не допомогло — Налаштування телефону → Програми → Chrome → Дозволи → Мікрофон.';
  if (/iPhone|iPad|iPod/i.test(UA)) return 'Немає доступу до мікрофона. Налаштування iPhone → Safari → Мікрофон → «Дозволити» (або «аА» в адресному рядку → Параметри вебсайту → Мікрофон).';
  return 'Немає доступу до мікрофона. Натисніть значок замка ліворуч від адреси сайту → Мікрофон → Дозволити, і спробуйте ще раз.';
}

export const S = {
  app: 'myEnglish',
  nav: {
    home: 'Головна', tutor: 'Вчитель', cards: 'Картки', vocab: 'Лексика', grammar: 'Граматика',
    listening: 'Аудіювання', reading: 'Читання', pronunciation: 'Вимова', writing: 'Письмо', scenarios: 'Розмова',
    sounds: 'Звуки', exgrammar: 'Граматика', exercises: 'Вправи',
    tests: 'Тести', mistakes: 'Помилки', progress: 'Прогрес', analysis: 'Аналіз', report: 'Звіт', settings: 'Налаштування', profile: 'Профіль', friends: 'Друзі',
    session: 'Заняття', auth: 'Вхід', lab: 'Лабораторія Live', diary: 'Щоденник', games: 'Ігри',
    today: 'Мій день', phrases: 'Фразник', fluency: 'Плавність', listengo: 'У дорозі',
  },
  navLong: { tutor: 'Вчитель', vocab: 'Слова й фрази', sounds: 'Звуки й вимова', mistakes: 'Мої помилки', scenarios: 'Сценарії', exgrammar: 'Граматика', tests: 'Тести', analysis: 'Аналіз навчання', report: 'Звіт за місяць', today: 'Мій день за 15 хвилин', phrases: 'Фразник', fluency: 'Тренажер плавності', listengo: 'Слухати в дорозі' },
  groups: { learn: 'Вивчати', practice: 'Практикувати', check: 'Контроль і прогрес', me: 'Я' },
  menu: 'Меню', close: 'Закрити', back: 'Назад', themeToggle: 'Перемкнути тему',
  streak: (n) => `Стрік: ${n} ${plural(n, 'день', 'дні', 'днів')} поспіль`,
  greet: (h) => h < 5 ? 'Добрий вечір' : h < 12 ? 'Доброго ранку' : h < 18 ? 'Добрий день' : 'Добрий вечір',
  logout: 'Вийти', login: 'Увійти', weekTime: 'За 7 днів',
  guest: 'Локальний режим',
  save: 'Зберегти', cancel: 'Скасувати', delete: 'Видалити', edit: 'Редагувати', add: 'Додати',
  done: 'Готово', next: 'Далі', check: 'Перевірити', retry: 'Ще раз', start: 'Почати', finish: 'Завершити',
  listen: 'Прослухати', speak: 'Сказати', show: 'Показати',
  offline: 'Немає мережі — AI недоступний, картки й уроки працюють',
  online: 'Мережу відновлено',
  synced: 'Синхронізовано',
  saved: 'Збережено',
  err: {
    generic: 'Щось пішло не так. Спробуйте ще раз.',
    needLogin: 'AI-функції працюють після входу в акаунт.',
    notAllowed: 'Для цього акаунта AI вимкнено. Зверніться до власника застосунку.',
    noKey: 'AI ще не налаштовано: додайте GEMINI_API_KEY у секрети Supabase.',
    quota: 'Денний ліміт AI вичерпано. Завтра знову буде доступно.',
    rate: 'Gemini тимчасово обмежив кількість запитів (безкоштовний тариф). Спробуйте за хвилину.',
    busy: 'Сервери Gemini зараз перевантажені. Спробуйте ще раз за хвилину.',
    aiFailed: 'AI не зміг відповісти. Спробуйте ще раз або переформулюйте.',
    offline: 'Немає мережі. AI працює лише онлайн.',
    mic: micHelp(),
    micUnsupported: inApp() ? 'Цей вбудований браузер (месенджер чи соцмережа) не дає доступу до мікрофона. Відкрийте сайт у Chrome або Safari: меню ⋮ → «Відкрити в браузері».' : 'Цей браузер не дає доступу до мікрофона. Відкрийте сайт у Chrome, Safari або Edge.',
    micMissing: 'Мікрофон не знайдено.',
    speechUnsupported: 'Цей браузер не вміє розпізнавати мовлення. Спробуйте Chrome або Edge.',
    tokenExpired: 'Голосову сесію завершено: термін дії токена минув. Почніть нову.',
    network: 'Зв\'язок перервано. Перепідключаюся…',
  },
  level: {
    A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper-Intermediate', C1: 'Advanced',
  },
  mistakeTypes: {
    articles: 'Артиклі a/the', tenses: 'Часи', prepositions: 'Прийменники', word_order: 'Порядок слів',
    vocabulary: 'Лексика', pronunciation: 'Вимова', other: 'Інше',
  },
  sessionTypes: {
    cards: 'Картки', grammar: 'Граматика', tutor: 'Вчитель', voice: 'Голос', listening: 'Аудіювання', reading: 'Читання',
    pronunciation: 'Вимова', writing: 'Письмо', test: 'Тест', session: 'Заняття', vocab: 'Лексика', mistakes: 'Помилки', diary: 'Щоденник', game: 'Ігри', fluency: 'Плавність',
  },
};

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
