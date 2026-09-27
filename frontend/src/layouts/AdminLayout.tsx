import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const navigation = [{ label: 'Overview', to: '/admin/overview' }, { label: 'Users', to: '/admin/users' }, { label: 'Trip Reviews', to: '/admin/trip-reviews' }, { label: 'Providers', to: '/admin/providers' }, { label: 'Safety Map', to: '/admin/map' }, { label: 'Audit Logs', to: '/admin/audit-logs' }, { label: 'Settings', to: '/admin/settings' }]

export function AdminLayout({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const signOut = () => { logout(); navigate('/login', { replace: true }) }
  return <div className="operator-shell"><aside className="operator-sidebar"><a className="operator-brand" href="/admin/overview">Voyara <span>ADMIN</span></a><nav>{navigation.map((item) => <NavLink className={({ isActive }) => `operator-nav-link ${isActive ? 'is-active' : ''}`} key={item.label} to={item.to}>{item.label}</NavLink>)}</nav><button className="operator-logout" onClick={signOut} type="button">Logout →</button></aside><main className="operator-main">{children}</main></div>
}
