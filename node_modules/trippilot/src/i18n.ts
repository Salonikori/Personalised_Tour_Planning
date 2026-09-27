import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import hi from './locales/hi.json'

export const LANGUAGE_STORAGE_KEY = 'voyara-lang'

function getInitialLanguage(): 'en' | 'hi' {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'hi' || stored === 'en') return stored
  } catch { /* localStorage unavailable */ }
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: 'en' | 'hi') {
  void i18n.changeLanguage(lang)
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang) } catch { /* ignore */ }
  document.documentElement.lang = lang
}

document.documentElement.lang = getInitialLanguage()

export default i18n
