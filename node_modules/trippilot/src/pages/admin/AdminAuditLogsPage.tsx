import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Input } from '../../components/Input'
import { AdminLayout } from '../../layouts/AdminLayout'
import { getAuditLogs, type AuditLogEntry } from '../../services/adminService'

export function AdminAuditLogsPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => { try { setLoading(true); setError(''); setEntries(await getAuditLogs(action || undefined)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load audit logs.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <AdminLayout><section className="operator-page"><header className="operator-page-heading"><div><p className="eyebrow">Admin console</p><h1>Audit trail.</h1><p>Every recorded system and user action, most recent first.</p></div></header>
    <div className="vendor-form" style={{ maxWidth: 360 }}><Input label="Filter by action" onChange={(event) => setAction(event.target.value)} placeholder="e.g. INVENTORY, ADMIN_" value={action} /><button className="tp-button tp-button-secondary" onClick={() => void load()} type="button">Filter</button></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <Card className="operator-table-card"><div className="operator-table"><div className="operator-table-head"><span>Action</span><span>Actor</span><span>When</span><span>Details</span></div>
      {loading && <p className="page-copy">Loading audit logs…</p>}
      {!loading && !entries.length && <p className="page-copy">No matching entries.</p>}
      {entries.map((entry) => <div className="operator-table-row" key={entry.id}>
        <span>{entry.action}</span>
        <span>{entry.actor ? `${entry.actor.name} (${entry.actor.role})` : 'System'}</span>
        <span>{new Date(entry.createdAt).toLocaleString()}</span>
        <span>{entry.metadata ? Object.entries(entry.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(', ') : '—'}</span>
      </div>)}
    </div></Card>
  </section></AdminLayout>
}
