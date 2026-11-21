import assert from 'node:assert/strict';
import { getLocale, initializeLanguage, LANGUAGES, normalizeLocale, setLocale } from '../src/i18n';
assert.equal(import.meta.env.MODE, 'public');
assert.deepEqual(LANGUAGES.map(language => language.id), ['en', 'pt-BR']);
assert(!LANGUAGES.some(language => /\p{Script=Han}/u.test(language.name)));
setLocale('en'); assert.equal(setLocale('zh-CN'), false); assert.equal(getLocale(), 'en');
for (const alias of ['zh', 'zh-CN', 'zh_Hans', 'zh-TW']) assert.equal(normalizeLocale(alias), null);
let url = new URL('https://selene.test/?lang=zh-CN');
let storageAccesses = 0;
const testWindow = {
  navigator: { language: 'zh-CN' }, get location() { return url; },
  get localStorage() { storageAccesses++; throw new Error('Forbidden'); },
};
Object.assign(globalThis, { window: testWindow });
assert.equal(initializeLanguage(), 'en');
url.searchParams.set('lang', 'pt-BR'); assert.equal(initializeLanguage(), 'pt-BR');
url.searchParams.set('lang', 'zh-CN'); testWindow.navigator.language = 'pt-BR'; assert.equal(initializeLanguage(), 'pt-BR');
assert.equal(storageAccesses, 0);
console.log('PASS public edition offers only English and Brazilian Portuguese, rejects Chinese URL aliases and never accesses storage');
