import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import type { UserRole } from '../types/auth'

const destinations: Record<UserRole, string> = { traveler: '/traveler/onboarding', operator: '/operator/dashboard', vendor: '/vendor', coordinator: '/coordinator/schedule', admin: '/admin/overview' }
export function RoleGuard({ allow }: { allow: UserRole }) { const { role } = useAuth(); return role === allow ? <Outlet /> : <Navigate replace to={role ? destinations[role] : '/login'} /> }
