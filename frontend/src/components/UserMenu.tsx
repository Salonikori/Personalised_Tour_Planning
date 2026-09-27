import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { roleLabelKey } from '../services/authService'

export function UserMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { logout, user } = useAuth()
  const { t } = useTranslation()
  if (!user) return null
  const signOut = () => { logout(); navigate('/login', { replace: true }) }
  return <div className="user-menu"><button aria-expanded={open} className="user-menu-trigger" onClick={() => setOpen((value) => !value)} type="button"><span>{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><i>{user.name}</i></button>{open && <div className="user-menu-popover"><strong>{user.name}</strong><span>{t(roleLabelKey(user.role))}</span><small>{user.email}</small><button onClick={() => setOpen(false)} type="button">{t('userMenu.profile')}</button><button onClick={signOut} type="button">{t('userMenu.logout')}</button></div>}</div>
}
