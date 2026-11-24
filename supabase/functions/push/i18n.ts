// Тексти push-сповіщень мовою інтерфейсу одержувача (profiles.data.settings.lang; немає — українська).
// Українські рядки — ті самі, що й раніше (logic_test.ts їх перевіряє); ru — «вы», es — tú, pt — você, tr — siz, pl — ty.
// Сповіщення адміністраторам (автомонітор, нові звернення) лишаються українською — їх читає власник.
import { readUiLang, type UiLang } from '../_shared/prompts.ts';

/** Слов'янські форми множини: 1 · 2–4 · 5+ (uk, ru) */
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
/** Польська: 1 — one; 2–4 (крім 12–14) — few; решта — many (21 — many) */
export function pluralPl(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n);
  if (a === 1) return one;
  const b = a % 10, c = a % 100;
  return b >= 2 && b <= 4 && !(c >= 12 && c <= 14) ? few : many;
}
const pl2 = (n: number, one: string, other: string) => (Math.abs(n) === 1 ? one : other);

export type PushText = {
  group: string; student: string;
  cards: (n: number) => string; minutes: (n: number) => string;
  streakTitle: string; streakBody: (streak: number, left: string) => string;
  cardsTitle: string; cardsExtra: (left: string) => string;
  anyTitle: string; anyBody: (left: string) => string;
  duelTitle: string; duelBody: (sender: string, game: string, group: string | null) => string; game: string; games: Record<string, string>;
  challengeDm: (sender: string) => string; challengeGroup: (group: string) => string; sevenDays: string;
  voice: (body: string) => string; dmTitle: (sender: string) => string; groupTitle: (group: string) => string;
  challengeLabel: (kind: string, target: number) => string;
  nudgeTitle: (label: string) => string; nudgeBody: (room: string, value: number, target: number, kind: string, left: number) => string;
  hwNewTitle: (room: string) => string; topicTitle: (room: string) => string; hwNewBody: (q: string) => string;
  weeklyTitle: (room: string) => string; tutorTitle: (room: string) => string;
  hwDoTitle: (room: string | null) => string; hwDoBody: (left: number) => string;
  friendReqTitle: string; friendReqBody: (name: string) => string; friendOkTitle: string; friendOkBody: (name: string) => string;
  devReplyTitle: string; groupInviteTitle: string; groupInviteBody: (name: string, room: string) => string;
};

const uk: PushText = {
  group: 'Група', student: 'Учень',
  cards: n => `${n} ${plural(n, 'картка чекає', 'картки чекають', 'карток чекають')} на повторення.`,
  minutes: n => `${n} ${plural(n, 'хвилину', 'хвилини', 'хвилин')}`,
  streakTitle: 'Стрік під загрозою',
  streakBody: (s, left) => `Ваш стрік — ${s} ${plural(s, 'день', 'дні', 'днів')}. Позаймайтеся ще ${left}, щоб його зберегти.`,
  cardsTitle: 'Час повторити картки', cardsExtra: left => ` Ще ${left} практики — і день зарахується в стрік.`,
  anyTitle: 'Час для англійської', anyBody: left => `Ще ${left} практики — і сьогоднішній день зарахується в стрік.`,
  duelTitle: 'Вас кличуть на дуель', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · група ${gr}` : ''} — хто більше?`, game: 'гра',
  games: { detective: 'Детектив помилок', rush: 'Швидкий переклад' },
  challengeDm: s => `${s} пропонує виклик`, challengeGroup: g => `Новий виклик у групі ${g}`, sevenDays: '7 днів',
  voice: b => (b ? `голосове: ${b}` : 'голосове повідомлення'), dmTitle: s => `Вам пише ${s}`, groupTitle: g => `Нові повідомлення в групі ${g}`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? '15 хв щодня' : `15 хв · ${t} ${plural(t, 'день', 'дні', 'днів')}`)
    : kind === 'words' ? `${t} слів за тиждень` : kind === 'talks' ? `${t} ${plural(t, 'розмова', 'розмови', 'розмов')} з вчителем` : 'Виклик',
  nudgeTitle: l => `Наздоганяйте у виклику «${l}»`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}у вас ${v} з ${t} ${kind === 'daily15' ? 'днів' : kind === 'words' ? 'слів' : 'розмов'}. ${left > 0 ? `Лишилось ${left} ${plural(left, 'день', 'дні', 'днів')}.` : 'Сьогодні останній день!'}`,
  hwNewTitle: r => `Нове домашнє завдання · «${r}»`, topicTitle: r => `Тема дня в групі «${r}»`, hwNewBody: q => `У кожного своє — відкрийте й подивіться. Тема дня: ${q}`,
  weeklyTitle: r => `Підсумок тижня в групі «${r}»`, tutorTitle: r => `Вчитель у групі «${r}»`,
  hwDoTitle: r => `Виконайте домашнє завдання${r ? ` · «${r}»` : ''}`, hwDoBody: n => `Лишилось ${n} з 3 — термін завтра. Встигнете!`,
  friendReqTitle: 'Запит у друзі', friendReqBody: n => `${n} хоче додати вас у друзі`,
  friendOkTitle: 'Запит прийнято', friendOkBody: n => `${n} тепер у ваших друзях — напишіть англійською!`,
  devReplyTitle: 'Відповідь розробника', groupInviteTitle: 'Запрошення в групу', groupInviteBody: (n, r) => `${n} запрошує вас у групу «${r}»`,
};

const ru: PushText = {
  group: 'Группа', student: 'Ученик',
  cards: n => `${n} ${plural(n, 'карточка ждёт', 'карточки ждут', 'карточек ждут')} повторения.`,
  minutes: n => `${n} ${plural(n, 'минуту', 'минуты', 'минут')}`,
  streakTitle: 'Серия под угрозой',
  streakBody: (s, left) => `Ваша серия — ${s} ${plural(s, 'день', 'дня', 'дней')}. Позанимайтесь ещё ${left}, чтобы её сохранить.`,
  cardsTitle: 'Пора повторить карточки', cardsExtra: left => ` Ещё ${left} практики — и день засчитается в серию.`,
  anyTitle: 'Время для английского', anyBody: left => `Ещё ${left} практики — и сегодняшний день засчитается в серию.`,
  duelTitle: 'Вас вызывают на дуэль', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · группа ${gr}` : ''} — кто больше?`, game: 'игра',
  games: { detective: 'Детектив ошибок', rush: 'Быстрый перевод' },
  challengeDm: s => `${s} предлагает челлендж`, challengeGroup: g => `Новый челлендж в группе ${g}`, sevenDays: '7 дней',
  voice: b => (b ? `голосовое: ${b}` : 'голосовое сообщение'), dmTitle: s => `Вам пишет ${s}`, groupTitle: g => `Новые сообщения в группе ${g}`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? '15 мин в день' : `15 мин · ${t} ${plural(t, 'день', 'дня', 'дней')}`)
    : kind === 'words' ? `${t} слов за неделю` : kind === 'talks' ? `${t} ${plural(t, 'разговор', 'разговора', 'разговоров')} с учителем` : 'Челлендж',
  nudgeTitle: l => `Догоняйте в челлендже «${l}»`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}у вас ${v} из ${t} ${kind === 'daily15' ? 'дней' : kind === 'words' ? 'слов' : 'разговоров'}. ${left > 0 ? `Осталось ${left} ${plural(left, 'день', 'дня', 'дней')}.` : 'Сегодня последний день!'}`,
  hwNewTitle: r => `Новое домашнее задание · «${r}»`, topicTitle: r => `Тема дня в группе «${r}»`, hwNewBody: q => `У каждого своё — откройте и посмотрите. Тема дня: ${q}`,
  weeklyTitle: r => `Итоги недели в группе «${r}»`, tutorTitle: r => `Учитель в группе «${r}»`,
  hwDoTitle: r => `Выполните домашнее задание${r ? ` · «${r}»` : ''}`, hwDoBody: n => `Осталось ${n} из 3 — срок завтра. Успеете!`,
  friendReqTitle: 'Запрос в друзья', friendReqBody: n => `${n} хочет добавить вас в друзья`,
  friendOkTitle: 'Запрос принят', friendOkBody: n => `${n} теперь у вас в друзьях — напишите по-английски!`,
  devReplyTitle: 'Ответ разработчика', groupInviteTitle: 'Приглашение в группу', groupInviteBody: (n, r) => `${n} приглашает вас в группу «${r}»`,
};

const es: PushText = {
  group: 'Grupo', student: 'Estudiante',
  cards: n => (n === 1 ? '1 tarjeta te espera para repasar.' : `${n} tarjetas te esperan para repasar.`),
  minutes: n => `${n} ${pl2(n, 'minuto', 'minutos')}`,
  streakTitle: 'Tu racha está en peligro',
  streakBody: (s, left) => `Tu racha: ${s} ${pl2(s, 'día', 'días')}. Practica ${left} más para mantenerla.`,
  cardsTitle: 'Hora de repasar tarjetas', cardsExtra: left => ` Con ${left} más de práctica, el día contará para tu racha.`,
  anyTitle: 'Hora de inglés', anyBody: left => `Con ${left} más de práctica, hoy contará para tu racha.`,
  duelTitle: 'Te retan a un duelo', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · grupo ${gr}` : ''}: ¿quién hace más?`, game: 'juego',
  games: { detective: 'Detective de errores', rush: 'Traducción rápida' },
  challengeDm: s => `${s} te propone un reto`, challengeGroup: g => `Nuevo reto en el grupo ${g}`, sevenDays: '7 días',
  voice: b => (b ? `mensaje de voz: ${b}` : 'mensaje de voz'), dmTitle: s => `${s} te escribe`, groupTitle: g => `Nuevos mensajes en el grupo ${g}`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? '15 min al día' : `15 min · ${t} ${pl2(t, 'día', 'días')}`)
    : kind === 'words' ? `${t} palabras en una semana` : kind === 'talks' ? `${t} ${pl2(t, 'conversación', 'conversaciones')} con el profesor` : 'Reto',
  nudgeTitle: l => `Ponte al día en el reto «${l}»`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}llevas ${v} de ${t} ${kind === 'daily15' ? 'días' : kind === 'words' ? 'palabras' : 'conversaciones'}. ${left > 0 ? (left === 1 ? 'Queda 1 día.' : `Quedan ${left} días.`) : '¡Hoy es el último día!'}`,
  hwNewTitle: r => `Nueva tarea · «${r}»`, topicTitle: r => `Tema del día en el grupo «${r}»`, hwNewBody: q => `Cada uno tiene la suya: ábrela y échale un vistazo. Tema del día: ${q}`,
  weeklyTitle: r => `Resumen de la semana en el grupo «${r}»`, tutorTitle: r => `El profesor en el grupo «${r}»`,
  hwDoTitle: r => `Haz tu tarea${r ? ` · «${r}»` : ''}`, hwDoBody: n => `Te quedan ${n} de 3 y el plazo termina mañana. ¡Tú puedes!`,
  friendReqTitle: 'Solicitud de amistad', friendReqBody: n => `${n} te ha enviado una solicitud de amistad`,
  friendOkTitle: 'Solicitud aceptada', friendOkBody: n => `${n} y tú ya son amigos: ¡escríbele en inglés!`,
  devReplyTitle: 'Respuesta del desarrollador', groupInviteTitle: 'Invitación a un grupo', groupInviteBody: (n, r) => `${n} te invita al grupo «${r}»`,
};

const pt: PushText = {
  group: 'Grupo', student: 'Aluno',
  cards: n => (n === 1 ? '1 cartão está esperando revisão.' : `${n} cartões estão esperando revisão.`),
  minutes: n => `${n} ${pl2(n, 'minuto', 'minutos')}`,
  streakTitle: 'Sua sequência está em risco',
  streakBody: (s, left) => `Sua sequência: ${s} ${pl2(s, 'dia', 'dias')}. Pratique mais ${left} para mantê-la.`,
  cardsTitle: 'Hora de revisar os cartões', cardsExtra: left => ` Mais ${left} de prática e o dia conta na sua sequência.`,
  anyTitle: 'Hora do inglês', anyBody: left => `Mais ${left} de prática e hoje conta na sua sequência.`,
  duelTitle: 'Desafio de duelo para você', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · grupo ${gr}` : ''} — quem faz mais?`, game: 'jogo',
  games: { detective: 'Detetive de erros', rush: 'Tradução rápida' },
  challengeDm: s => `${s} propõe um desafio`, challengeGroup: g => `Novo desafio no grupo ${g}`, sevenDays: '7 dias',
  voice: b => (b ? `áudio: ${b}` : 'mensagem de voz'), dmTitle: s => `${s} escreveu para você`, groupTitle: g => `Novas mensagens no grupo ${g}`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? '15 min por dia' : `15 min · ${t} ${pl2(t, 'dia', 'dias')}`)
    : kind === 'words' ? `${t} palavras na semana` : kind === 'talks' ? `${t} ${pl2(t, 'conversa', 'conversas')} com o professor` : 'Desafio',
  nudgeTitle: l => `Recupere o ritmo no desafio «${l}»`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}você tem ${v} de ${t} ${kind === 'daily15' ? 'dias' : kind === 'words' ? 'palavras' : 'conversas'}. ${left > 0 ? (left === 1 ? 'Falta 1 dia.' : `Faltam ${left} dias.`) : 'Hoje é o último dia!'}`,
  hwNewTitle: r => `Nova lição de casa · «${r}»`, topicTitle: r => `Tema do dia no grupo «${r}»`, hwNewBody: q => `Cada um tem a sua — abra e confira. Tema do dia: ${q}`,
  weeklyTitle: r => `Resumo da semana no grupo «${r}»`, tutorTitle: r => `O professor no grupo «${r}»`,
  hwDoTitle: r => `Faça a lição de casa${r ? ` · «${r}»` : ''}`, hwDoBody: n => `Faltam ${n} de 3 — o prazo termina amanhã. Dá tempo!`,
  friendReqTitle: 'Pedido de amizade', friendReqBody: n => `${n} enviou um pedido de amizade para você`,
  friendOkTitle: 'Pedido aceito', friendOkBody: n => `Agora você e ${n} são amigos — escreva em inglês!`,
  devReplyTitle: 'Resposta do desenvolvedor', groupInviteTitle: 'Convite para grupo', groupInviteBody: (n, r) => `${n} convidou você para o grupo «${r}»`,
};

const tr: PushText = {
  group: 'Grup', student: 'Öğrenci',
  cards: n => `${n} kart tekrar için sizi bekliyor.`,
  minutes: n => `${n} dakika`,
  streakTitle: 'Seriniz tehlikede',
  streakBody: (s, left) => `Seriniz: ${s} gün. Korumak için ${left} daha çalışın.`,
  cardsTitle: 'Kart tekrarı zamanı', cardsExtra: left => ` ${left} daha pratik yapın, gün serinize sayılsın.`,
  anyTitle: 'İngilizce zamanı', anyBody: left => `${left} daha pratik yapın, bugün serinize sayılsın.`,
  duelTitle: 'Düelloya davet edildiniz', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · grup ${gr}` : ''} — kim daha çok?`, game: 'oyun',
  games: { detective: 'Hata Dedektifi', rush: 'Hızlı Çeviri' },
  challengeDm: s => `${s} size bir meydan okuma öneriyor`, challengeGroup: g => `${g} grubunda yeni meydan okuma`, sevenDays: '7 gün',
  voice: b => (b ? `sesli mesaj: ${b}` : 'sesli mesaj'), dmTitle: s => `${s} size yazıyor`, groupTitle: g => `${g} grubunda yeni mesajlar`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? 'Günde 15 dk' : `15 dk · ${t} gün`)
    : kind === 'words' ? `Haftada ${t} kelime` : kind === 'talks' ? `Öğretmenle ${t} konuşma` : 'Meydan okuma',
  nudgeTitle: l => `«${l}» meydan okumasında geride kalmayın`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}${t} ${kind === 'daily15' ? 'gün' : kind === 'words' ? 'kelime' : 'konuşma'} hedefinin ${v} tanesi tamam. ${left > 0 ? `${left} gün kaldı.` : 'Bugün son gün!'}`,
  hwNewTitle: r => `Yeni ödev · «${r}»`, topicTitle: r => `«${r}» grubunda günün konusu`, hwNewBody: q => `Herkesin ödevi kendine özel — açıp bakın. Günün konusu: ${q}`,
  weeklyTitle: r => `«${r}» grubunda haftanın özeti`, tutorTitle: r => `«${r}» grubunda öğretmen`,
  hwDoTitle: r => `Ödevinizi tamamlayın${r ? ` · «${r}»` : ''}`, hwDoBody: n => `3 görevden ${n} tanesi kaldı — süre yarın doluyor. Yetişirsiniz!`,
  friendReqTitle: 'Arkadaşlık isteği', friendReqBody: n => `${n} sizi arkadaş olarak eklemek istiyor`,
  friendOkTitle: 'İstek kabul edildi', friendOkBody: n => `${n} artık arkadaşınız — ona İngilizce yazın!`,
  devReplyTitle: 'Geliştiriciden yanıt', groupInviteTitle: 'Grup daveti', groupInviteBody: (n, r) => `${n} sizi «${r}» grubuna davet ediyor`,
};

const pl: PushText = {
  group: 'Grupa', student: 'Uczeń',
  cards: n => `${n} ${pluralPl(n, 'fiszka czeka', 'fiszki czekają', 'fiszek czeka')} na powtórkę.`,
  minutes: n => `${n} ${pluralPl(n, 'minutę', 'minuty', 'minut')}`,
  streakTitle: 'Twoja seria jest zagrożona',
  streakBody: (s, left) => `Twoja seria: ${s} ${pluralPl(s, 'dzień', 'dni', 'dni')}. Poćwicz jeszcze ${left}, żeby ją utrzymać.`,
  cardsTitle: 'Czas powtórzyć fiszki', cardsExtra: left => ` Jeszcze ${left} ćwiczeń i dzień zaliczy się do serii.`,
  anyTitle: 'Czas na angielski', anyBody: left => `Jeszcze ${left} ćwiczeń i dzisiejszy dzień zaliczy się do serii.`,
  duelTitle: 'Wyzwanie na pojedynek', duelBody: (s, g, gr) => `${s} · ${g}${gr ? ` · grupa ${gr}` : ''} — kto więcej?`, game: 'gra',
  games: { detective: 'Detektyw błędów', rush: 'Szybkie tłumaczenie' },
  challengeDm: s => `${s} proponuje wyzwanie`, challengeGroup: g => `Nowe wyzwanie w grupie ${g}`, sevenDays: '7 dni',
  voice: b => (b ? `wiadomość głosowa: ${b}` : 'wiadomość głosowa'), dmTitle: s => `${s} pisze do ciebie`, groupTitle: g => `Nowe wiadomości w grupie ${g}`,
  challengeLabel: (kind, t) => kind === 'daily15' ? (t >= 7 ? '15 min dziennie' : `15 min · ${t} ${pluralPl(t, 'dzień', 'dni', 'dni')}`)
    : kind === 'words' ? `${t} ${pluralPl(t, 'słowo', 'słowa', 'słów')} w tydzień` : kind === 'talks' ? `${t} ${pluralPl(t, 'rozmowa', 'rozmowy', 'rozmów')} z nauczycielem` : 'Wyzwanie',
  nudgeTitle: l => `Nadrabiaj w wyzwaniu «${l}»`,
  nudgeBody: (room, v, t, kind, left) => `${room ? `${room}: ` : ''}masz ${v} z ${t} (${kind === 'daily15' ? 'dni' : kind === 'words' ? 'słowa' : 'rozmowy'}). ${left > 0 ? `Do końca: ${left} ${pluralPl(left, 'dzień', 'dni', 'dni')}.` : 'Dziś ostatni dzień!'}`,
  hwNewTitle: r => `Nowa praca domowa · «${r}»`, topicTitle: r => `Temat dnia w grupie «${r}»`, hwNewBody: q => `Każdy ma swoją — otwórz i zobacz. Temat dnia: ${q}`,
  weeklyTitle: r => `Podsumowanie tygodnia w grupie «${r}»`, tutorTitle: r => `Nauczyciel w grupie «${r}»`,
  hwDoTitle: r => `Zrób pracę domową${r ? ` · «${r}»` : ''}`, hwDoBody: n => `Do zrobienia: ${n} z 3 — termin mija jutro. Dasz radę!`,
  friendReqTitle: 'Zaproszenie do znajomych', friendReqBody: n => `${n} chce dodać cię do znajomych`,
  friendOkTitle: 'Zaproszenie przyjęte', friendOkBody: n => `${n} jest teraz w twoich znajomych — napisz po angielsku!`,
  devReplyTitle: 'Odpowiedź dewelopera', groupInviteTitle: 'Zaproszenie do grupy', groupInviteBody: (n, r) => `${n} zaprasza cię do grupy «${r}»`,
};

export const PUSH_TEXT: Record<UiLang, PushText> = { uk, ru, es, pt, tr, pl };
/** Тексти мовою одержувача: будь-яке невідоме значення — українська */
export const pushText = (lang: unknown): PushText => PUSH_TEXT[readUiLang(lang)];
