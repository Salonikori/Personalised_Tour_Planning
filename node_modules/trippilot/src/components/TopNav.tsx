import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { operatorRoutes, travelerMoreRoutes, travelerRoutes } from '../lib/routes'
import { useAuth } from '../auth/AuthContext'
import { UserMenu } from './UserMenu'
import { NotificationCenter } from './NotificationCenter'
import { LanguageSwitcher } from './LanguageSwitcher'

export function TopNav() {
  const { role } = useAuth()
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link rounded px-2 py-1 text-sm transition-colors ${isActive ? 'nav-link-active' : ''}`

  return (
    <header className="top-nav">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-4">
        <a className="brand mr-1 text-lg font-bold" href="/">Voyara</a>
        {role === 'traveler' && <div className="flex flex-wrap items-center gap-1">{travelerRoutes.map(({ path, key }) => <NavLink className={linkClass} key={path} to={path}>{t(`routes.${key}`)}</NavLink>)}<div className="relative"><button className="nav-link rounded px-2 py-1 text-sm transition-colors" onClick={()=>setMoreOpen(v=>!v)} type="button">{t('routes.more')} ▾</button>{moreOpen&&<div className="absolute right-0 z-50 mt-2 min-w-48 rounded-xl border border-[var(--tp-border)] bg-[var(--tp-surface)] p-2 shadow-xl">{travelerMoreRoutes.map(({path,key})=><NavLink className="block rounded px-3 py-2 text-sm hover:bg-[var(--tp-surface-2)]" key={path} onClick={()=>setMoreOpen(false)} to={path}>{t(`routes.${key}`)}</NavLink>)}</div>}</div></div>}
        {role === 'operator' && <div className="nav-operator flex flex-wrap items-center gap-1 pl-4">
          {operatorRoutes.map(({ path, key }) => <NavLink className={linkClass} key={path} to={path}>{t(`routes.${key}`)}</NavLink>)}
        </div>}
        <LanguageSwitcher className="ml-2" /><NotificationCenter /><UserMenu />
      </nav>
    </header>
  )
}
