import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Input } from '../components/Input'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useAuth } from '../auth/AuthContext'
import { roleLabelKey } from '../services/authService'
import type { UserRole } from '../types/auth'

const roles: UserRole[] = ['traveler', 'operator']
function destination(role: UserRole, onboarded: boolean) { return role === 'traveler' ? onboarded ? '/traveler' : '/traveler/onboarding' : role === 'operator' ? '/operator' : role === 'coordinator' ? '/coordinator/schedule' : role === 'admin' ? '/admin/overview' : '/vendor' }

export function LoginPage() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [role, setRole] = useState<UserRole>('traveler')
  const [email, setEmail] = useState('traveler@trippilot.io')
  const [password, setPassword] = useState('TripPilotAccess!')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [forgotShown, setForgotShown] = useState(false)
  const [currentLocation, setCurrentLocation] = useState('')
  useEffect(() => {
    if (role !== 'traveler' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => setCurrentLocation((existing) => existing ? existing : `${position.coords.latitude.toFixed(2)}, ${position.coords.longitude.toFixed(2)}`),
      () => { /* Permission denied or unavailable - the text field stays the source of truth. */ },
      { timeout: 8000 },
    )
  }, [role])
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (!email || !password) { setError(t('login.enterCredentials')); return } try { const user = await login({ email, password, role, remember, currentLocation: role === 'traveler' && currentLocation ? currentLocation : undefined }); const requested = (location.state as { from?: string } | null)?.from; navigate(requested ?? destination(user.role, user.onboardingComplete), { replace: true }) } catch (reason) { setError(reason instanceof Error ? reason.message : t('login.unableToSignIn')) } }
  return <section className="auth-page"><div className="auth-brand"><Link to="/login">Voyara<span>✦</span></Link><p>{t('login.tagline')}</p><LanguageSwitcher /></div><Card className="auth-card" style={{ position: 'relative' }}><Link className="auth-inline-message" style={{ position: 'absolute', top: '1rem', right: '1.5rem' }} to="/about">{t('login.aboutVoyara')}</Link><p className="eyebrow">{t('login.eyebrow')}</p><h1>{t('login.title')}</h1><p className="auth-copy">{t('login.copy')}</p><form onSubmit={submit}><div className="auth-role-selector">{roles.map((item) => <button className={role === item ? 'is-active' : ''} key={item} onClick={() => { setRole(item); setEmail(`${item}@trippilot.io`); setPassword('TripPilotAccess!') }} type="button">{t(roleLabelKey(item))}</button>)}</div><Input label={t('login.email')} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} /><div className="auth-password"><Input label={t('login.password')} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} value={password} /><button onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? t('login.hide') : t('login.show')}</button></div>{role === 'traveler' && <Input label={t('login.whereTravelingFrom')} onChange={(event) => setCurrentLocation(event.target.value)} placeholder={t('login.cityCountry')} value={currentLocation} />}<div className="auth-options"><label><input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" /> {t('login.rememberMe')}</label><button onClick={() => setForgotShown((value) => !value)} type="button">{t('login.forgotPassword')}</button></div>{forgotShown && <p className="auth-inline-message">{t('login.recoveryMessage')}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<Button disabled={loading} type="submit">{loading ? t('login.signingIn') : t('login.loginButton')}</Button></form><p className="auth-footer">{t('login.newToVoyara')} <Link to="/register">{t('login.createAccount')}</Link></p></Card></section>
}
