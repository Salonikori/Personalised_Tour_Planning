import { useEffect, useMemo, useState } from 'react'
import { Card } from '../components/Card'
import { SafetyMap } from '../components/safety/SafetyMap'
import { getAdminSafetyMap, type AdminSafetyMap } from '../services/safetyService'

const empty: AdminSafetyMap = { zones: [], reports: [], clicks: [], clicksByZone: {}, summary: { totalReports: 0, totalZones: 0, unsafeZones: 0, cautionZones: 0, totalClicks: 0 } }

export function MapOperatorPage() {
  const [data, setData] = useState<AdminSafetyMap>(empty)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    void getAdminSafetyMap()
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load the red zone map.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const redZones = useMemo(() => data.zones.filter((zone) => zone.status === 'UNSAFE'), [data.zones])
  const reportsByZone = useMemo(() => {
    const map = new Map<string, typeof data.reports>()
    redZones.forEach((zone) => {
      map.set(zone.id, data.reports.filter((report) => report.zone?.id === zone.id))
    })
    return map
  }, [redZones, data.reports])

  return <section className="operator-page safety-page">
    <header className="operator-page-heading">
      <div>
        <p className="eyebrow">Operator · read only</p>
        <h1>Red zone map.</h1>
        <p>Every area the automated safety review has marked unsafe, with the report log explaining why each one was flagged.</p>
      </div>
    </header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <section className="operator-kpis">
      <Card className="operator-kpi is-danger"><span>Red zones</span><strong>{redZones.length}</strong><small>Marked automatically</small></Card>
      <Card className="operator-kpi is-primary"><span>Reports behind them</span><strong>{redZones.reduce((sum, zone) => sum + zone.reportCount, 0)}</strong><small>Total reports in red zones</small></Card>
    </section>
    <div className="safety-grid">
      <Card>
        <div className="safety-map-head">
          <div><h2>Red zones</h2><p className="page-copy">Only zones the automated review has marked unsafe are shown here.</p></div>
        </div>
        <SafetyMap zones={redZones} reports={data.reports.filter((report) => report.zone && redZones.some((zone) => zone.id === report.zone!.id))} height={600} />
        <div className="safety-legend"><span><i className="safety-dot safety-red" />Red zone (unsafe)</span></div>
      </Card>
      <Card className="redzone-log-card">
        <p className="eyebrow">Why they're red-zoned</p>
        <h2>Zone log</h2>
        {loading && !redZones.length && <p className="page-copy">Loading…</p>}
        {!loading && !redZones.length && <p className="page-copy">No zones are currently marked unsafe.</p>}
        <div className="redzone-log">
          {redZones.map((zone) => <div className="redzone-log-item" key={zone.id}>
            <div className="redzone-log-item-head">
              <span className="safety-status safety-status-unsafe">UNSAFE</span>
              <span>{zone.latitude.toFixed(4)}, {zone.longitude.toFixed(4)}</span>
            </div>
            <p className="redzone-log-reason">{zone.reason || 'Automated review flagged this area based on report volume.'}</p>
            <p className="redzone-log-meta">{zone.reportCount} report{zone.reportCount === 1 ? '' : 's'} · {zone.confidence == null ? 'confidence unavailable' : `${Math.round(zone.confidence * 100)}% confidence`} · updated {new Date(zone.updatedAt).toLocaleString()}</p>
            {(reportsByZone.get(zone.id) || []).slice(0, 5).map((report) => <p className="redzone-log-entry" key={report.id}>
              <strong>{report.category}</strong> · {new Date(report.createdAt).toLocaleString()}{report.message ? ` — ${report.message}` : ''}
            </p>)}
          </div>)}
        </div>
      </Card>
    </div>
  </section>
}
