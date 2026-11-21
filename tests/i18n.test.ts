import assert from 'node:assert/strict';
import { messages } from '../src/i18n-messages';
import { getLocale, initializeLanguage, label, normalizeLocale, routeHref, setLocale, t } from '../src/i18n';
import { DOCTRINES, PRIORITIES, UNIT_ORDER, UNIT_SPECS } from '../src/data';
import { MISSION_LIST } from '../src/missions';
import { createLevel, levelToMission, parseLevel } from '../src/level';
import { validatePlaytest } from '../src/level-validation';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const tokens = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const han = /\p{Script=Han}/u;
check('every English and Brazilian Portuguese translation is present, contains no Chinese and preserves placeholders', () => {
  for (const [key, translations] of Object.entries(messages)) for (const text of translations) {
    assert(text.trim(), key); assert(!han.test(text), key); assert.deepEqual(tokens(text), tokens(key), key);
  }
});
check('all supported locale aliases normalize while unknown locales are rejected', () => {
  assert.equal(normalizeLocale(' EN-us '), 'en'); assert.equal(normalizeLocale('pt_BR'), 'pt-BR');
  assert.equal(normalizeLocale('pt-PT'), 'pt-BR'); assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('fr'), null); const before = getLocale(); assert.equal(setLocale('fr'), false); assert.equal(getLocale(), before);
});
check('interpolation is single pass, HTML text is escaped and unknown keys remain readable', () => {
  setLocale('en'); assert.equal(t('切换到 {name}', { name: '{name} <custom>' }), 'Switch to {name} <custom>');
  assert.equal(t('unknown'), 'unknown'); assert.equal(t('__proto__'), '__proto__');
  assert(!label('<script>"&').includes('<script>')); assert(label('<script>"&').includes('&lt;script&gt;'));
});
const numeric = () => JSON.stringify({ units: Object.fromEntries(UNIT_ORDER.map(kind => [kind, Object.fromEntries(Object.entries(UNIT_SPECS[kind]).filter(([, value]) => typeof value === 'number'))])), missions: MISSION_LIST.map(mission => ({ budget: mission.budget, timeLimit: mission.timeLimit, playerDeployment: mission.playerDeployment, enemyDeployment: mission.enemyDeployment, waves: mission.waves })) });
check('unit names, tactics and all four mission briefings update live without changing balance', () => {
  setLocale('en'); const en = UNIT_SPECS.rifle.name, baseline = numeric();
  assert.equal(MISSION_LIST.length, 4);
  for (const locale of ['en', 'pt-BR'] as const) {
    setLocale(locale);
    for (const kind of UNIT_ORDER) for (const field of ['name', 'short', 'role', 'description'] as const) assert(!han.test(UNIT_SPECS[kind][field]), `${kind}.${field}`);
    for (const mission of MISSION_LIST) for (const field of ['name', 'code', 'focus', 'hint', 'objective', 'success', 'victoryTitle'] as const) assert(!han.test(mission[field]), `${mission.id}.${field}`);
    for (const order of [...DOCTRINES, ...PRIORITIES]) assert(!han.test(order.label));
    assert.equal(numeric(), baseline);
  }
  assert.notEqual(UNIT_SPECS.rifle.name, en); setLocale('zh-CN'); assert(han.test(UNIT_SPECS.rifle.name));
});
check('player content and JSON IDs survive language changes while validation messages are localized', () => {
  const level = createLevel('bastion'); level.name = 'Minha missão / 我的关卡 <b>{p0}</b>'; const original = JSON.stringify(level);
  for (const locale of ['en', 'pt-BR', 'zh-CN'] as const) {
    setLocale(locale); const decoded = parseLevel(original); assert.deepEqual(decoded, JSON.parse(original));
    assert.equal(levelToMission(decoded).name, level.name);
    const empty = createLevel('blank'); const issues = validatePlaytest(empty, { isWalkable: () => true, heightAt: () => 0 });
    assert.equal(issues.length, 2); if (locale !== 'zh-CN') for (const issue of issues) assert(!han.test(issue.message));
    assert.throws(() => parseLevel('{}'), error => error instanceof Error && (locale === 'zh-CN' || !han.test(error.message)));
  }
});

check('validation errors already on screen translate their field names and values after a switch', () => {
  setLocale('zh-CN'); const level = createLevel('blank'); level.budget = -2;
  let captured: Error | undefined;
  try { parseLevel(level); } catch (error) { if (error instanceof Error) captured = error; }
  assert(captured); assert(han.test(captured.message));
  setLocale('en'); assert(captured.message.includes('Supply budget')); assert(!han.test(captured.message));
  setLocale('pt-BR'); assert(captured.message.includes('Orçamento de suprimentos')); assert(!han.test(captured.message));
});

let url = new URL('https://selene.test/game.html?mission=relay&editor=1');
const meta = { content: '' }, html = { lang: '' };
let storageAccesses = 0;
const testWindow = {
  navigator: { language: 'en-US' }, get location() { return url; },
  get localStorage() { storageAccesses++; throw new Error('Storage is forbidden'); },
  history: { state: null, replaceState: (_state: unknown, _title: string, value: URL) => { url = new URL(value); } },
};
Object.assign(globalThis, { window: testWindow, document: { documentElement: html, querySelector: () => meta } });
check('English is the default and Portuguese browsers start in Brazilian Portuguese without accessing storage', () => {
  assert.equal(initializeLanguage(), 'en'); testWindow.navigator.language = 'pt-BR'; assert.equal(initializeLanguage(), 'pt-BR'); assert.equal(storageAccesses, 0);
});
check('URL locale overrides browser language without a saved preference', () => {
  url.searchParams.set('lang', 'en'); assert.equal(initializeLanguage(), 'en');
  url.searchParams.set('lang', 'pt-BR'); assert.equal(initializeLanguage(), 'pt-BR');
  url.searchParams.set('lang', 'invalid'); assert.equal(initializeLanguage(), 'pt-BR');
});
check('switching updates URL and metadata without storing any preference', () => {
  setLocale('pt-BR'); assert.equal(html.lang, 'pt-BR'); assert(meta.content.includes('Lua')); assert.equal(storageAccesses, 0);
  assert.equal(url.searchParams.get('mission'), 'relay'); assert.equal(url.searchParams.get('editor'), '1'); assert.equal(url.searchParams.get('lang'), 'pt-BR');
  assert.equal(routeHref({ mission: 'bastion' }), '?mission=bastion&lang=pt-BR'); assert.equal(routeHref({ editor: 1 }), '?editor=1&lang=pt-BR');
});
check('file history restrictions do not break language switching or localized navigation', () => {
  testWindow.history.replaceState = () => { throw new Error('file history blocked'); };
  url = new URL('file:///game.html?lang=pt-BR'); assert.equal(initializeLanguage(), 'pt-BR'); assert(setLocale('en')); assert.equal(html.lang, 'en'); assert(routeHref().includes('lang=en')); assert.equal(storageAccesses, 0);
});
console.log(`${passed} localization checks passed`);
