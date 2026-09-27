import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const navigation = [{ label: 'Dashboard', to: '/operator/dashboard' }, { label: 'Operations', to: '/operator/disruptions' }, { label: 'Customers & Resources', to: '/operator/resources' }, { label: 'Vendors', to: '/operator/vendors' }, { label: 'Marketplace', to: '/operator/marketplace' }, { label: 'Groups', to: '/operator/groups' }, { label: 'Payments', to: '/operator/payments' }, { label: 'Analytics', to: '/operator/analytics' }, { label: 'Digital Twin', to: '/operator/digital-twin' }, { label: 'Red Zone Map', to: '/mapoperator' }]

export function OperatorLayout({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const signOut = () => { logout(); navigate('/login', { replace: true }) }
  return <div className="operator-shell"><aside className="operator-sidebar"><a className="operator-brand" href="/operator/dashboard">Voyara <span>OPS</span></a><nav>{navigation.map((item) => <NavLink className={({ isActive }) => `operator-nav-link ${isActive ? 'is-active' : ''}`} key={item.label} to={item.to}>{item.label}</NavLink>)}</nav><button className="operator-logout" onClick={signOut} type="button">Logout →</button></aside><main className="operator-main">{children}</main></div>
}

