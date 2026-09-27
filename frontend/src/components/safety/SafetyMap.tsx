import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.heat'
import type { SafetyZone, SafetyReport } from '../../services/safetyService'

const statusColor = (status: string) => status === 'UNSAFE' ? '#dc2626' : status === 'CAUTION' ? '#f59e0b' : '#16a34a'

type Props = {
  zones: SafetyZone[]
  reports?: SafetyReport[]
  center?: [number, number]
  liveLocation?: [number, number] | null
  selectable?: boolean
  onMapClick?: (lat: number, lng: number) => void
  height?: number | string
}

export function SafetyMap({ zones, reports = [], center = [20.5937, 78.9629], liveLocation, selectable = false, onMapClick, height = 560 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const heatRef = useRef<L.Layer | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { zoomControl: true }).setView(center, 5)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    const layers = L.layerGroup().addTo(map)
    map.on('click', (event) => { if (selectable && onMapClick) onMapClick(event.latlng.lat, event.latlng.lng) })
    mapRef.current = map
    layersRef.current = layers
    return () => { map.remove(); mapRef.current = null; layersRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()
    if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null }
    const heatPoints: Array<[number, number, number]> = []
    zones.forEach((zone) => {
      heatPoints.push([zone.latitude, zone.longitude, Math.min(1, Math.max(0.15, zone.reportCount / 12))])
      const circle = L.circleMarker([zone.latitude, zone.longitude], { radius: Math.min(18, 7 + zone.reportCount / 2), color: statusColor(zone.status), fillColor: statusColor(zone.status), fillOpacity: 0.35, weight: 2 })
      circle.bindPopup(`<strong>${zone.status}</strong><br/>${zone.reportCount} report${zone.reportCount === 1 ? '' : 's'}<br/><small>${zone.reason || 'Safety assessment pending.'}</small>`)
      circle.addTo(layers)
    })
    if (heatPoints.length) {
      const heat = (L as typeof L & { heatLayer: (p: Array<[number, number, number]>, o?: Record<string, unknown>) => L.Layer }).heatLayer(heatPoints, { radius: 34, blur: 26, maxZoom: 16, minOpacity: 0.35 })
      heat.addTo(map)
      heatRef.current = heat
    }
    reports.forEach((report) => {
      const marker = L.circleMarker([report.latitude, report.longitude], { radius: 5, color: '#111827', fillColor: '#111827', fillOpacity: 0.7, weight: 1 })
      marker.bindPopup(`<strong>${report.category}</strong><br/>${new Date(report.createdAt).toLocaleString()}${report.user ? `<br/>${report.user.name}` : ''}${report.message ? `<br/>${report.message}` : ''}`)
      marker.addTo(layers)
    })
    if (liveLocation) {
      const marker = L.circleMarker(liveLocation, { radius: 9, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.9, weight: 3 })
      marker.bindTooltip('Your live location').openTooltip().addTo(layers)
      map.setView(liveLocation, Math.max(map.getZoom(), 13))
    } else if (zones.length && map.getZoom() < 8) {
      map.fitBounds(L.latLngBounds(zones.map((zone) => [zone.latitude, zone.longitude] as [number, number])), { padding: [30, 30] })
    }
  }, [zones, reports, liveLocation])

  return <div ref={ref} style={{ height, width: '100%', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--tp-border)' }} />
}
