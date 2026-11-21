import { messages } from './i18n-messages';

export type Locale = 'en' | 'pt-BR' | 'zh-CN';
export type MessageValues = Record<string, string | number>;
const publicEdition = import.meta.env.MODE === 'public';
export const LANGUAGES: readonly { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  ...(!publicEdition ? [{ id: 'zh-CN' as const, name: '简体中文' }] : []),
];

let locale: Locale = 'en';
const listeners = new Set<() => void>();
export function getLocale() { return locale; }

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const code = value?.trim().toLowerCase().replaceAll('_', '-');
  if (code === 'en' || code?.startsWith('en-')) return 'en';
  if (code === 'pt' || code?.startsWith('pt-')) return 'pt-BR';
  if (!publicEdition && (code === 'zh' || code?.startsWith('zh-'))) return 'zh-CN';
  return null;
}

export function t(key: string, values: MessageValues = {}): string {
  const entry = Object.hasOwn(messages, key) ? messages[key as keyof typeof messages] : undefined;
  const text = locale === 'zh-CN' || !entry ? key : entry[locale === 'en' ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** A localized text node in HTML templates, updated in place when the locale changes. */
export function label(key: string): string {
  return `<span data-i18n="${escapeHTML(key)}">${escapeHTML(t(key))}</span>`;
}

/** Keep a visible validation error translatable after the user changes language. */
export function localizedError(render: () => string): Error {
  const error = new Error();
  Object.defineProperty(error, 'message', { configurable: true, get: render });
  return error;
}

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (description) description.content = t('月面战术自走棋。部署部队、预设命令，观察你的决策改变战局。');
}

export function setLocale(value: string, options: { updateUrl?: boolean } = {}): boolean {
  const next = normalizeLocale(value);
  if (!next) return false;
  const changed = next !== locale;
  locale = next;
  if (typeof window !== 'undefined') {
    if (options.updateUrl !== false) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', locale);
        window.history.replaceState(window.history.state, '', url);
      } catch { /* Some file:// browsers restrict history changes. Navigation links carry the locale. */ }
    }
  }
  updateDocument();
  if (changed) for (const listener of listeners) listener();
  return true;
}

export function initializeLanguage(): Locale {
  let requested: Locale | null = null;
  if (typeof window !== 'undefined') {
    requested = normalizeLocale(new URLSearchParams(window.location.search).get('lang'));
  }
  // English is the default; Portuguese browsers start in Brazilian Portuguese.
  const browser = typeof window !== 'undefined' && window.navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  setLocale(requested ?? browser, { updateUrl: false });
  return locale;
}

export function translateElements(root: HTMLElement) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.dataset.i18n!);
  for (const attribute of ['title', 'aria-label'] as const) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)!));
  }
  for (const select of root.querySelectorAll<HTMLSelectElement>('[data-language]')) select.value = locale;
}

export function onLocaleChange(root: HTMLElement, render: () => void): () => void {
  const listener = () => {
    if (!root.isConnected || root.ownerDocument !== document) { unsubscribe(); return; }
    render();
  };
  const unsubscribe = () => { listeners.delete(listener); window.removeEventListener('pagehide', unsubscribe); };
  listeners.add(listener);
  window.addEventListener('pagehide', unsubscribe, { once: true });
  return unsubscribe;
}

export function languageSwitcher(): string {
  return `<label class="language-switcher"><select data-language aria-label="${t('语言')}" data-i18n-aria-label="语言" title="${t('语言')}" data-i18n-title="语言">${LANGUAGES.map(language => `<option value="${language.id}" ${locale === language.id ? 'selected' : ''}>${language.name}</option>`).join('')}</select></label>`;
}

export function bindLanguageSwitcher(root: HTMLElement) {
  for (const select of root.querySelectorAll<HTMLSelectElement>('[data-language]')) select.addEventListener('change', () => setLocale(select.value));
}

/** Query-only links work both on a local server and in the offline HTML file. */
export function routeHref(parameters: Record<string, string | number> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) query.set(key, String(value));
  query.set('lang', locale);
  return `?${query}`;
}

/** Locale-only re-renders must not reset unfinished property edits or selections. */
export function preserveFormState(root: HTMLElement, render: () => void) {
  const fields = () => [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="file"]), select:not([data-language]), textarea')];
  const fieldKey = (field: HTMLElement) => field.id || [...field.attributes].filter(attribute => attribute.name.startsWith('data-') || attribute.name === 'name').map(attribute => `${attribute.name}=${attribute.value}`).join('|');
  const snapshots = fields().map(field => ({ key: fieldKey(field), value: field.value, checked: field.tagName === 'INPUT' ? (field as HTMLInputElement).checked : false }));
  render();
  for (const field of fields()) {
    const snapshot = snapshots.find(item => item.key && item.key === fieldKey(field));
    if (!snapshot) continue;
    field.value = snapshot.value;
    if (field.tagName === 'INPUT') (field as HTMLInputElement).checked = snapshot.checked;
  }
}
