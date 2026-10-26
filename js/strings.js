// Усі рядки інтерфейсу. Одна мова — українська.
export const S = {
  app: 'myEnglish',
  nav: {
    home: 'Головна', tutor: 'Вчитель', cards: 'Картки', vocab: 'Лексика', grammar: 'Граматика',
    listening: 'Аудіювання', pronunciation: 'Вимова', writing: 'Письмо', scenarios: 'Розмова',
    sounds: 'Звуки', exgrammar: 'Граматика', exercises: 'Вправи',
    tests: 'Тести', mistakes: 'Помилки', progress: 'Прогрес', settings: 'Налаштування',
    session: 'Заняття', auth: 'Вхід', lab: 'Лабораторія Live',
  },
  navLong: { tutor: 'Вчитель (AI)', vocab: 'Слова й фрази', sounds: 'Звуки й вимова', mistakes: 'Мої помилки', scenarios: 'Розмова (сценарії)', exgrammar: 'Граматика', tests: 'Тести' },
  groups: { theory: 'Теорія', practice: 'Вправи', me: 'Я' },
  menu: 'Меню', close: 'Закрити', back: 'Назад', themeToggle: 'Перемкнути тему',
  streak: (n) => `Стрік: ${n} ${plural(n, 'день', 'дні', 'днів')} поспіль`,
  greet: (h) => h < 5 ? 'Доброї ночі' : h < 12 ? 'Доброго ранку' : h < 18 ? 'Добрий день' : 'Добрий вечір',
  name: 'Павле',
  logout: 'Вийти', login: 'Увійти', weekTime: 'За 7 днів',
  guest: 'Локальний режим',
  save: 'Зберегти', cancel: 'Скасувати', delete: 'Видалити', edit: 'Редагувати', add: 'Додати',
  done: 'Готово', next: 'Далі', check: 'Перевірити', retry: 'Ще раз', start: 'Почати', finish: 'Завершити',
  listen: 'Прослухати', speak: 'Сказати', show: 'Показати',
  offline: 'Немає мережі — AI недоступний, картки й уроки працюють',
  online: 'Мережа відновлена',
  synced: 'Синхронізовано',
  saved: 'Збережено',
  err: {
    generic: 'Щось пішло не так. Спробуйте ще раз.',
    needLogin: 'AI-функції працюють після входу в акаунт.',
    notAllowed: 'Цей акаунт не має доступу до AI (allowlist).',
    noKey: 'AI ще не налаштовано: додайте GEMINI_API_KEY у секрети Supabase.',
    quota: 'Денний ліміт AI вичерпано. Завтра знову буде доступно.',
    rate: 'Gemini тимчасово обмежив запити (free tier). Спробуйте за хвилину.',
    busy: 'Сервери Gemini зараз перевантажені. Спробуйте ще раз за хвилину.',
    offline: 'Немає мережі. AI працює лише онлайн.',
    mic: 'Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.',
    micMissing: 'Мікрофон не знайдено.',
    speechUnsupported: 'Цей браузер не вміє розпізнавати мову. Спробуйте Chrome або Edge.',
    tokenExpired: 'Сесія голосу завершилась (токен прострочено). Почніть нову.',
    network: 'Зв\'язок перервано. Перепідключаюсь…',
  },
  level: {
    A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper-Intermediate', C1: 'Advanced',
  },
  mistakeTypes: {
    articles: 'Артиклі a/the', tenses: 'Часи', prepositions: 'Прийменники', word_order: 'Порядок слів',
    vocabulary: 'Лексика', pronunciation: 'Вимова', other: 'Інше',
  },
  sessionTypes: {
    cards: 'Картки', grammar: 'Граматика', tutor: 'Вчитель', voice: 'Голос', listening: 'Аудіювання',
    pronunciation: 'Вимова', writing: 'Письмо', test: 'Тест', session: 'Заняття', vocab: 'Лексика',
  },
};

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
