// Реєстр розділів: маршрут, іконка Phosphor, емодзі Fluent, група меню
import { S } from './strings.js';

export const SECTIONS = [
  { id: 'home', icon: 'house', emoji: 'house', group: null },
  { id: 'tutor', icon: 'chat-circle-dots', emoji: 'teacher', group: 'learn' },
  { id: 'cards', icon: 'cards', emoji: 'cards', group: 'learn' },
  { id: 'vocab', icon: 'book-open-text', emoji: 'book', group: 'learn' },
  { id: 'grammar', icon: 'puzzle-piece', emoji: 'puzzle', group: 'learn' },
  { id: 'listening', icon: 'headphones', emoji: 'headphone', group: 'skills' },
  { id: 'pronunciation', icon: 'waveform', emoji: 'mouth', group: 'skills' },
  { id: 'writing', icon: 'pencil-line', emoji: 'writing', group: 'skills' },
  { id: 'scenarios', icon: 'users-three', emoji: 'theater', group: 'skills' },
  { id: 'tests', icon: 'exam', emoji: 'memo', group: 'check' },
  { id: 'mistakes', icon: 'warning-circle', emoji: 'target', group: 'check' },
  { id: 'progress', icon: 'chart-line-up', emoji: 'chart', group: 'me' },
  { id: 'settings', icon: 'gear-six', emoji: 'gear', group: 'me' },
].map(s => ({ ...s, label: S.nav[s.id], long: S.navLong[s.id] || S.nav[s.id] }));

export const byId = Object.fromEntries(SECTIONS.map(s => [s.id, s]));
export const GROUPS = ['learn', 'skills', 'check', 'me'];
