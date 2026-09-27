import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { StatusBadge } from '../components/StatusBadge'
import { getCoordinatorSchedule, type OperatorScheduleItem } from '../services/operatorService'
import { subscribeToOperatorUpdates } from '../services/operatorService'

export function CoordinatorSchedulePage() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<OperatorScheduleItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = () => { void getCoordinatorSchedule().then(setItems).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load your assigned tours.')).finally(() => setLoading(false)) }
  useEffect(() => { load(); return subscribeToOperatorUpdates(load) }, [])
  const signOut = () => { logout(); navigate('/login', { replace: true }) }
  return <section className="coordinator-shell"><header className="operator-page-heading"><div><p className="eyebrow">Coordinator workspace</p><h1>Your assigned tour schedule.</h1><p>Traveler details, timings, providers, and booking status for tours assigned to you.</p></div><button className="tp-button tp-button-secondary" onClick={signOut} type="button">Sign out</button></header>{error && <p className="auth-error" role="alert">{error}</p>}<Card className="operator-table-card"><div className="resource-table"><div className="resource-row resource-head"><span>When</span><span>Service</span><span>Tour & traveler</span><span>Provider</span><span>Status</span></div>{loading && <p className="page-copy">Loading assigned tours…</p>}{items.map((item) => <div className="resource-row" key={item.id}><strong>{new Date(item.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong><span>{item.title} · {item.type}</span><span>{item.destination}<small>{item.traveler.name} · {item.traveler.email}</small></span><span>{item.vendor?.name || 'Provider unassigned'}<small>{item.location}</small></span><span><StatusBadge status={item.bookingStatus === 'CONFIRMED' ? 'confirmed' : item.status === 'AT_RISK' ? 'at-risk' : 'pending'} /></span></div>)}{!loading && items.length === 0 && <p className="page-copy">No itinerary items are assigned to you yet. Ask an operator to assign you to a tour.</p>}</div></Card></section>
}
