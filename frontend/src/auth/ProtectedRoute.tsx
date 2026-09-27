import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() { const { isAuthenticated, loading } = useAuth(); const location = useLocation(); if (loading) return <div className="auth-route-loading">Checking your session…</div>; return isAuthenticated ? <Outlet /> : <Navigate replace state={{ from: location.pathname }} to="/login" /> }
