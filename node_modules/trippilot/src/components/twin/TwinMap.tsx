import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { TwinCityInfo, TwinEntityImpact } from '../../services/digitalTwinService'

const riskColor = (risk: number) => risk >= 55 ? '#dc2626' : risk >= 25 ? '#f59e0b' : '#16a34a'
const categoryIcon = (category: TwinEntityImpact['category']) => ({ HOTEL: '🏨', TRANSPORT_HUB: '✈️', ATTRACTION: '🎡', RESTAURANT: '🍽️', WORKFORCE_POOL: '👷' }[category] ?? '📍')

type Props = { city: TwinCityInfo; impacts: TwinEntityImpact[]; height?: number | string }

export function TwinMap({ city, impacts, height = 460 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, { zoomControl: true }).setView([city.latitude, city.longitude], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    layersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; layersRef.current = null }
  }, [])

  // Recenter when the selected city changes.
  useEffect(() => { mapRef.current?.setView([city.latitude, city.longitude], 11) }, [city.id, city.latitude, city.longitude])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()

    // City centroid marker.
    const cityMarker = L.divIcon({ className: 'twin-city-marker', html: `<span>🌆</span>`, iconSize: [30, 30] })
    L.marker([city.latitude, city.longitude], { icon: cityMarker }).bindTooltip(`${city.name}, ${city.country}`).addTo(layers)

    impacts.forEach((impact) => {
      const color = riskColor(impact.meanRiskPct)
      const circle = L.circleMarker([impact.latitude, impact.longitude], {
        radius: Math.min(20, 8 + impact.meanRiskPct / 8), color, fillColor: color, fillOpacity: 0.4, weight: 2,
      })
      const deltaSign = impact.deltaPct > 0 ? '+' : ''
      circle.bindPopup(`
        <strong>${categoryIcon(impact.category)} ${impact.name}</strong><br/>
        Tier ${impact.order} · ${impact.category.replace('_', ' ')}<br/>
        ${impact.metric}: ${impact.baseline} → <strong>${impact.projected}</strong> (${deltaSign}${impact.deltaPct}%)<br/>
        Mean risk: <strong>${impact.meanRiskPct}%</strong> ± ${impact.uncertaintyPct}pp<br/>
        <small>${impact.rationale}</small>
      `)
      circle.addTo(layers)
    })

    if (impacts.length) {
      const bounds = L.latLngBounds([[city.latitude, city.longitude], ...impacts.map((i) => [i.latitude, i.longitude] as [number, number])])
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 })
    }
  }, [city, impacts])

  return <div ref={ref} style={{ height, width: '100%', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--tp-border)' }} />
}
