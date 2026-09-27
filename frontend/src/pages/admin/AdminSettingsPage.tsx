import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Input } from '../../components/Input'
import { AdminLayout } from '../../layouts/AdminLayout'
import { getPlatformSettings, updatePlatformSettings, type PlatformSettings } from '../../services/adminService'

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => { void getPlatformSettings().then(setSettings).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load settings.')).finally(() => setLoading(false)) }, [])
  const update = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => setSettings((current) => current ? { ...current, [key]: value } : current)
  const save = async () => {
    if (!settings) return
    try { setSaving(true); setError(''); setSuccess(''); const updated = await updatePlatformSettings({ platformName: settings.platformName, supportEmail: settings.supportEmail, maintenanceMode: settings.maintenanceMode, bookingFeePercent: settings.bookingFeePercent }); setSettings(updated); setSuccess('Settings saved.') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save settings.') } finally { setSaving(false) }
  }
  return <AdminLayout><section className="operator-page"><header className="operator-page-heading"><div><p className="eyebrow">Admin console</p><h1>Platform settings.</h1><p>Controls that apply across every traveler, operator, vendor, and coordinator workspace.</p></div></header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {success && <p className="auth-inline-message" role="status">{success}</p>}
    {loading && <p className="page-copy">Loading settings…</p>}
    {settings && <Card className="vendor-form" style={{ maxWidth: 480 }}>
      <Input label="Platform name" onChange={(event) => update('platformName', event.target.value)} value={settings.platformName} />
      <Input label="Support email" onChange={(event) => update('supportEmail', event.target.value)} type="email" value={settings.supportEmail} />
      <Input label="Booking fee (%)" max="100" min="0" onChange={(event) => update('bookingFeePercent', Number(event.target.value))} type="number" value={settings.bookingFeePercent} />
      <label className="auth-terms"><input checked={settings.maintenanceMode} onChange={(event) => update('maintenanceMode', event.target.checked)} type="checkbox" /> Maintenance mode (shows a banner across the app)</label>
      <Button disabled={saving} onClick={() => void save()} type="button">{saving ? 'Saving…' : 'Save settings'}</Button>
    </Card>}
  </section></AdminLayout>
}
