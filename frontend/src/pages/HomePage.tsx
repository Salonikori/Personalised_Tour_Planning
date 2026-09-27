import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { destinationImage } from '../lib/destinationImages'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import './HomePage.css'

type Package = { id: string; name: string; destination: string; price: number; duration: string; mood: string; imageDestination: string }
const packages: Package[] = [
  { id: 'manali', name: 'Himalayan slow escape', destination: 'Manali', price: 16000, duration: '4 days · 3 nights', mood: 'Mountain air, pine trails and cozy stays', imageDestination: 'Kashmir' },
  { id: 'goa', name: 'Goa by the coast', destination: 'Goa', price: 20000, duration: '5 days · 4 nights', mood: 'Sunny beaches, Portuguese lanes and local food', imageDestination: 'Goa' },
  { id: 'japan', name: 'Japan, in full colour', destination: 'Japan', price: 62000, duration: '7 days · 6 nights', mood: 'City lights, quiet shrines and fast trains', imageDestination: 'Japan' },
  { id: 'italy', name: 'An Italian postcard', destination: 'Italy', price: 78000, duration: '7 days · 6 nights', mood: 'Canal-side evenings, art and long lunches', imageDestination: 'Italy' },
  { id: 'kolkata', name: 'Kolkata culture trail', destination: 'Kolkata', price: 12500, duration: '3 days · 2 nights', mood: 'Grand architecture, markets and food walks', imageDestination: 'Kolkata' },
  { id: 'brazil', name: 'Brazil beyond the beach', destination: 'Brazil', price: 55000, duration: '6 days · 5 nights', mood: 'Tropical colour, city energy and green escapes', imageDestination: 'Brazil' },
]
const packageStorageKey = 'voyara-selected-package'
function Icon({ kind }: { kind: 'login' | 'register' }) {
  return kind === 'login'
    ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3m9-8h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m5-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11-2v6m-3-3h6" /></svg>
}

export function HomePage() {
  const { isAuthenticated, user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(packageStorageKey)
      if (stored) setSelectedPackage(JSON.parse(stored) as Package)
    } catch { sessionStorage.removeItem(packageStorageKey) }
  }, [])
  const choosePackage = (item: Package) => {
    setSelectedPackage(item)
    sessionStorage.setItem(packageStorageKey, JSON.stringify(item))
    if (!isAuthenticated) navigate('/login', { state: { from: '/' } })
    else document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const planSelectedPackage = () => navigate('/traveler/onboarding')
  const startOwnTrip = () => { sessionStorage.removeItem(packageStorageKey); setSelectedPackage(null); navigate('/traveler/onboarding') }
  const browsePackages = () => document.getElementById('packages')?.scrollIntoView({ behavior: 'smooth' })

  return <main className="voyara-landing">
    <section className="voyara-hero" id="home">
      <video className="voyara-hero-video" src="/videos/trippilot-hero.mp4" autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
      <div className="voyara-hero-overlay" />
      <header className="voy-home-nav">
        <Link className="voy-home-brand" to="/">Voyara<span>✦</span></Link>
        <nav aria-label="Main navigation">
          <Link className="voy-home-about" to="/about">{t('home.ourStory')}</Link>
          {isAuthenticated ? <><span className="voy-home-greeting">{t('home.hi')}, {user?.name?.split(' ')[0] || t('home.traveller')}</span><Link className="voy-home-icon-link" to="/traveler/today">{t('home.myTrips')}</Link></> : <><Link className="voy-home-icon-link" aria-label={t('home.login')} title={t('home.login')} to="/login"><Icon kind="login" /><span>{t('home.login')}</span></Link><Link className="voy-home-icon-link" aria-label={t('home.register')} title={t('home.register')} to="/register"><Icon kind="register" /><span>{t('home.register')}</span></Link></>}
          <LanguageSwitcher />
        </nav>
      </header>
      <div className="voy-home-hero-copy">
        <p className="voy-home-eyebrow">{t('home.eyebrow')}</p>
        <h1>{t('home.heroTitleLine1')}<br />{t('home.heroTitleLine2')}</h1>
        <p>{t('home.heroCopy')}</p>
        <div className="voy-home-hero-actions">
          {isAuthenticated ? <><Link className="voy-home-button voy-home-button-light" to="/traveler/onboarding">{t('home.createTrip')} <span>↗</span></Link><button className="voy-home-button voy-home-button-glass" onClick={browsePackages} type="button">{t('home.bookTrip')} <span>↓</span></button></> : <><Link className="voy-home-button voy-home-button-light" to="/register">{t('home.startPlanning')} <span>↗</span></Link><button className="voy-home-button voy-home-button-glass" onClick={browsePackages} type="button">{t('home.explorePackages')} <span>↓</span></button></>}
        </div>
      </div>
      <div className="voy-home-hero-foot"><span>{t('home.footTag')}</span><span>{t('home.scrollDown')}</span></div>
    </section>

    <section className="voy-home-packages" id="packages">
      <div className="voy-home-section-head"><div><p className="voy-home-eyebrow voy-home-eyebrow-dark">{t('home.packagesEyebrow')}</p><h2>{t('home.packagesTitle')}</h2><p>{t('home.packagesCopy')}</p></div>{selectedPackage && <div className="voy-home-selected-note"><span>{t('home.yourPick')}</span><strong>{t(`home.packageList.${selectedPackage.id}.destination`)}</strong><small>{t('home.from')} ₹{selectedPackage.price.toLocaleString()} {t('home.perTraveller')}</small></div>}</div>
      <div className="voy-home-package-grid">{packages.map((item, index) => <article className={`voy-home-package ${selectedPackage?.id === item.id ? 'is-picked' : ''}`} key={item.id}>
        <button aria-label={`${t('home.choose')} ${t(`home.packageList.${item.id}.name`)}, ${t('home.startingAt')} ₹${item.price.toLocaleString()}`} className="voy-home-package-image" onClick={() => choosePackage(item)} type="button"><img alt={t(`home.packageList.${item.id}.destination`)} loading="lazy" src={destinationImage(item.imageDestination, index)} /><span>{item.duration}</span><i>↗</i></button>
        <div className="voy-home-package-info"><div className="voy-home-package-title"><div><span className="voy-home-place">{t(`home.packageList.${item.id}.destination`)}</span><h3>{t(`home.packageList.${item.id}.name`)}</h3></div><strong>₹{item.price.toLocaleString()}<small>{t('home.perTravellerSlash')}</small></strong></div><p>{t(`home.packageList.${item.id}.mood`)}</p><button className="voy-home-package-link" onClick={() => choosePackage(item)} type="button">{isAuthenticated ? t('home.chooseThisTrip') : t('home.signInToChoose')} <span>→</span></button></div>
      </article>)}</div>
      <p className="voy-home-price-note">{t('home.priceNote')}</p>
      {isAuthenticated && <div className="voy-home-next-step"><div><span>{t('home.readyWhenYouAre')}</span><h3>{selectedPackage ? `${t(`home.packageList.${selectedPackage.id}.destination`)} ${t('home.looksLikeGoodChoice')}` : t('home.makeTheTripYours')}</h3><p>{selectedPackage ? t('home.useAsStartingPoint') : t('home.chooseAboveOrBuild')}</p></div><div className="voy-home-next-actions">{selectedPackage ? <><button className="voy-home-button voy-home-button-dark" onClick={planSelectedPackage} type="button">{t('home.bookThisPackage')} <span>↗</span></button><button className="voy-home-text-action" onClick={startOwnTrip} type="button">{t('home.createDifferentTrip')}</button></> : <Link className="voy-home-button voy-home-button-dark" to="/traveler/onboarding">{t('home.createYourTrip')} <span>↗</span></Link>}</div></div>}
    </section>
    <footer className="voy-home-footer"><Link className="voy-home-brand voy-home-brand-dark" to="/">Voyara<span>✦</span></Link><span>{t('home.footerTagline')}</span><Link to="/about">{t('home.aboutVoyara')}</Link></footer>
  </main>
}
