import en from './locales/en.json';
import he from './locales/he.json';

export const ADMIN_UI_LANG_KEY = 'matriya_admin_ui_lang';

const PACKS = { en, he };

function getNested(obj, path) {
  return path.split('.').reduce((acc, part) => {
    if (acc == null) return undefined;
    return acc[part];
  }, obj);
}

/** Persisted UI language: English default, Hebrew optional. Never cleared on login. */
export function getUiLocale() {
  try {
    const v = localStorage.getItem(ADMIN_UI_LANG_KEY);
    if (v === 'he' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function setUiLocale(next) {
  const v = next === 'he' ? 'he' : 'en';
  try {
    localStorage.setItem(ADMIN_UI_LANG_KEY, v);
  } catch {
    /* ignore */
  }
  return v;
}

export function applyUiLocaleToDocument(locale = getUiLocale()) {
  const loc = locale === 'he' ? 'he' : 'en';
  if (typeof document === 'undefined') return;
  document.documentElement.lang = loc === 'he' ? 'he' : 'en';
  document.documentElement.dir = loc === 'he' ? 'rtl' : 'ltr';
}

/**
 * @param {string} path dot path e.g. "login.email"
 * @param {Record<string, string | number>} [vars] replaces {{key}} in string
 */
export function t(path, vars) {
  const locale = getUiLocale();
  let str = getNested(PACKS[locale] || PACKS.en, path);
  if (str === undefined) str = getNested(PACKS.en, path);
  if (typeof str !== 'string') str = path;
  if (vars && typeof str === 'string') {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.split(`{{${k}}}`).join(String(v));
    });
  }
  return str;
}
