import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card } from '../components/Card'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

const principleKeys = ['smartRecommendations', 'builtForDisruptions', 'oneWorkspace']

export function AboutPage() {
  const { t } = useTranslation()
  return <section className="auth-page"><div className="auth-brand"><Link to="/login">Voyara<span>✦</span></Link><p>{t('about.tagline')}</p><LanguageSwitcher /></div>
    <Card className="auth-card" style={{ maxWidth: 640 }}>
      <p className="eyebrow">{t('about.eyebrow')}</p>
      <h1>{t('about.title')}</h1>
      <p className="auth-copy">{t('about.copy')}</p>
      <div className="theme-samples" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
        {principleKeys.map((key) => <div key={key} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--tp-border)' }}><strong>{t(`about.principles.${key}.title`)}</strong><p className="page-copy">{t(`about.principles.${key}.body`)}</p></div>)}
      </div>
      <p className="auth-footer">{t('about.readyToExplore')} <Link to="/register">{t('about.createAccount')}</Link> {t('about.or')} <Link to="/login">{t('about.signIn')}</Link>.</p>
    </Card>
  </section>
}
