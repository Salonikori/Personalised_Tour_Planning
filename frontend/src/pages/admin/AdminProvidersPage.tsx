import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { AdminLayout } from '../../layouts/AdminLayout'
import { createVendor, getVendors, type CreateVendorInput, type Vendor } from '../../services/operatorService'

type VendorForm = Record<keyof CreateVendorInput, string>
const emptyForm: VendorForm = { name: '', category: '', availability: '', priceRange: '', reliabilityScore: '', confirmationRate: '', cancellationRate: '', responseTime: '' }
const availabilityStatus = (availability: string) => availability === 'Available' ? 'confirmed' : availability === 'Limited' ? 'pending' : 'at-risk'

export function AdminProvidersPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [form, setForm] = useState<VendorForm>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const loadVendors = async () => { try { setLoading(true); setError(''); setVendors(await getVendors()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load providers.') } finally { setLoading(false) } }
  useEffect(() => { void loadVendors() }, [])
  const update = (key: keyof VendorForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => {
    const input: CreateVendorInput = { name: form.name.trim(), category: form.category.trim(), availability: form.availability.trim(), priceRange: form.priceRange.trim(), reliabilityScore: Number(form.reliabilityScore), confirmationRate: Number(form.confirmationRate), cancellationRate: Number(form.cancellationRate), responseTime: Number(form.responseTime) }
    if (!input.name || !input.category || !input.availability || !input.priceRange || [form.reliabilityScore, form.confirmationRate, form.cancellationRate, form.responseTime].some((value) => !value.trim() || !Number.isFinite(Number(value)))) return setError('Complete every provider field with valid numbers before saving.')
    try { setSaving(true); setError(''); await createVendor(input); await loadVendors(); setForm(emptyForm); setModalOpen(false); setSuccess(`${input.name} was added to the provider network.`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save provider.') } finally { setSaving(false) }
  }
  return <AdminLayout><section className="operator-page"><header className="operator-page-heading"><div><p className="eyebrow">Admin console</p><h1>Provider directory.</h1><p>Every vendor powering trips across the platform, in one place.</p></div><Button onClick={() => { setSuccess(''); setModalOpen(true) }} type="button">Add Provider</Button></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {success && <p className="auth-inline-message" role="status">{success}</p>}
    <Card className="operator-table-card"><div className="operator-table vendor-table"><div className="operator-table-head"><span>Provider</span><span>Category</span><span>Contact</span><span>Availability</span><span>Reliability</span><span>Price range</span></div>
      {loading && <p className="page-copy">Loading providers…</p>}
      {!loading && !error && vendors.length === 0 && <p className="page-copy">No providers have been added yet.</p>}
      {vendors.map((vendor) => <div className="operator-table-row" key={vendor.id}><strong>{vendor.name}</strong><span>{vendor.category}</span><span>{vendor.user ? `${vendor.user.name} · ${vendor.user.email}` : 'Contact not linked'}</span><StatusBadge status={availabilityStatus(vendor.availability)} /><span>{vendor.reliabilityScore}%</span><span>{vendor.priceRange}</span></div>)}
    </div></Card>
    <Modal isOpen={modalOpen} onClose={() => !saving && setModalOpen(false)} title="Add provider"><div className="vendor-form"><Input label="Provider name" onChange={(event) => update('name', event.target.value)} placeholder="e.g. Kyoto Rail Co." required value={form.name} /><Input label="Category" onChange={(event) => update('category', event.target.value)} placeholder="Stay, Air, Experience…" required value={form.category} /><Input label="Availability" onChange={(event) => update('availability', event.target.value)} placeholder="Available, Limited…" required value={form.availability} /><Input label="Price range" onChange={(event) => update('priceRange', event.target.value)} placeholder="₹2k–₹5k" required value={form.priceRange} /><Input label="Reliability score" max="100" min="0" onChange={(event) => update('reliabilityScore', event.target.value)} required type="number" value={form.reliabilityScore} /><Input label="Confirmation rate" max="100" min="0" onChange={(event) => update('confirmationRate', event.target.value)} required type="number" value={form.confirmationRate} /><Input label="Cancellation rate" max="100" min="0" onChange={(event) => update('cancellationRate', event.target.value)} required type="number" value={form.cancellationRate} /><Input label="Response time (minutes)" min="0" onChange={(event) => update('responseTime', event.target.value)} required type="number" value={form.responseTime} /><Button disabled={saving} onClick={() => void save()} type="button">{saving ? 'Saving provider…' : 'Save provider'}</Button></div></Modal>
  </section></AdminLayout>
}
