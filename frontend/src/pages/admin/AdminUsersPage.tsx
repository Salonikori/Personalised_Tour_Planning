import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { Input } from '../../components/Input'
import { AdminLayout } from '../../layouts/AdminLayout'
import { getAdminUsers, updateAdminUserRole, type AdminUser } from '../../services/adminService'
import type { UserRole } from '../../types/auth'

const roles: UserRole[] = ['traveler', 'operator', 'vendor', 'coordinator', 'admin']

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const load = async () => { try { setLoading(true); setError(''); setUsers(await getAdminUsers(search ? { search } : undefined)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load users.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const changeRole = async (id: string, role: UserRole) => {
    try { setSavingId(id); setError(''); await updateAdminUserRole(id, role); setSuccess('Role updated.'); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update role.') } finally { setSavingId(null) }
  }
  return <AdminLayout><section className="operator-page"><header className="operator-page-heading"><div><p className="eyebrow">Admin console</p><h1>Manage users.</h1><p>Search accounts and adjust access across the platform.</p></div></header>
    <div className="vendor-form" style={{ maxWidth: 360 }}><Input label="Search by name or email" onChange={(event) => setSearch(event.target.value)} placeholder="e.g. saloni" value={search} /><button className="tp-button tp-button-secondary" onClick={() => void load()} type="button">Search</button></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {success && <p className="auth-inline-message" role="status">{success}</p>}
    <Card className="operator-table-card"><div className="operator-table"><div className="operator-table-head"><span>Name</span><span>Email</span><span>Role</span><span>Phone</span><span>Joined</span></div>
      {loading && <p className="page-copy">Loading users…</p>}
      {!loading && !users.length && <p className="page-copy">No users match your search.</p>}
      {users.map((user) => <div className="operator-table-row" key={user.id}>
        <strong>{user.name}</strong>
        <span>{user.email}</span>
        <select disabled={savingId === user.id} onChange={(event) => void changeRole(user.id, event.target.value as UserRole)} value={user.role.toLowerCase()}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select>
        <span>{user.phone || '—'}</span>
        <span>{new Date(user.createdAt).toLocaleDateString()}</span>
      </div>)}
    </div></Card>
  </section></AdminLayout>
}
