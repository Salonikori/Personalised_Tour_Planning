import { useTranslation } from 'react-i18next'
import { setLanguage } from '../i18n'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation()
  const current = i18n.language === 'hi' ? 'hi' : 'en'

  return (
    <div aria-label="Language" className={`language-switcher ${className}`} role="group">
      <button
        aria-pressed={current === 'en'}
        className={current === 'en' ? 'is-active' : ''}
        onClick={() => setLanguage('en')}
        type="button"
      >
        EN
      </button>
      <button
        aria-pressed={current === 'hi'}
        className={current === 'hi' ? 'is-active' : ''}
        onClick={() => setLanguage('hi')}
        type="button"
      >
        हिं
      </button>
    </div>
  )
}
