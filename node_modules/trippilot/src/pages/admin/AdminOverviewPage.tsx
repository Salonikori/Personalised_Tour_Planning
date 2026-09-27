import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { AdminLayout } from '../../layouts/AdminLayout'
import { getAdminOverview, subscribeToAdminUpdates, type AdminOverview } from '../../services/adminService'

const emptyOverview: AdminOverview = { usersByRole: [], tripsByStatus: [], vendorCount: 0, totalRevenue: 0, openDisruptions: 0, pendingApprovals: 0, recentActivity: [] }
const roleLabel: Record<string, string> = { TRAVELER: 'Travelers', OPERATOR: 'Operators', VENDOR: 'Vendors', COORDINATOR: 'Coordinators', ADMIN: 'Admins' }

export function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverview>(emptyOverview)
  const [error, setError] = useState('')
  useEffect(() => { const load = () => { void getAdminOverview().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Platform overview is unavailable.')) }; load(); return subscribeToAdminUpdates(load) }, [])
  const totalUsers = data.usersByRole.reduce((sum, entry) => sum + entry.count, 0)
  const cards = [
    { label: 'Total users', value: totalUsers.toString(), detail: 'Across every role', tone: 'primary' },
    { label: 'Providers', value: data.vendorCount.toString(), detail: 'Vendors on the network', tone: 'primary' },
    { label: 'Open disruptions', value: data.openDisruptions.toString(), detail: 'Currently unresolved', tone: 'danger' },
    { label: 'Pending approvals', value: data.pendingApprovals.toString(), detail: 'Recovery plans awaiting review', tone: 'warning' },
    { label: 'Platform revenue', value: `₹${data.totalRevenue.toLocaleString()}`, detail: 'Paid booking value', tone: 'success' },
  ]
  return <AdminLayout><section className="operator-page"><header className="operator-page-heading"><div><p className="eyebrow">Admin console</p><h1>Platform overview.</h1><p>A birds-eye view of who is on Voyara and what needs attention.</p></div></header>
    {error && <p className="auth-error">{error}</p>}
    <section className="operator-kpis">{cards.map((kpi) => <Card className={`operator-kpi is-${kpi.tone}`} key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.detail}</small></Card>)}</section>
    <section className="operator-priority"><div className="operator-section-heading"><div><p className="eyebrow">Users by role</p><h2>Who's on the platform</h2></div></div>
      <div className="operator-flagged-list">{data.usersByRole.map((entry) => <Card className="operator-flagged is-low" key={entry.role}><div className="operator-flagged-details"><h3>{roleLabel[entry.role] || entry.role}</h3><p>{entry.count} account(s)</p></div></Card>)}{!data.usersByRole.length && <Card><p className="page-copy">No users yet.</p></Card>}</div>
    </section>
    <section className="operator-priority"><div className="operator-section-heading"><div><p className="eyebrow">Trips by status</p><h2>Journey pipeline</h2></div></div>
      <div className="operator-flagged-list">{data.tripsByStatus.map((entry) => <Card className="operator-flagged is-low" key={entry.status}><div className="operator-flagged-details"><h3>{entry.status}</h3><p>{entry.count} trip(s)</p></div></Card>)}{!data.tripsByStatus.length && <Card><p className="page-copy">No trips recorded yet.</p></Card>}</div>
    </section>
    <Card className="operator-table-card"><h2 style={{ marginBottom: '1rem' }}>Recent platform activity</h2>{!data.recentActivity.length && <p className="page-copy">Nothing logged yet.</p>}{data.recentActivity.map((entry) => <div className="operator-table-row" key={entry.id}><span>{entry.action}</span><span>{entry.actor ? `${entry.actor.name} (${entry.actor.role})` : 'System'}</span><span>{new Date(entry.createdAt).toLocaleString()}</span></div>)}</Card>
  </section></AdminLayout>
}
