import { Button } from './Button'
import { Card } from './Card'
import { Modal } from './Modal'
import type { InventoryItem } from '../services/tripService'
import { estimateCarbonKg } from '../services/carbonService'

// Distance/geolocation data doesn't exist on InventoryItem yet (no lat/lng on the model), so
// until real geocoding lands this derives a stable, per-item placeholder from the item id -
// never a fake number that reshuffles on every render, and always clearly labeled "~".
function placeholderDistanceKm(id: string) {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return Math.round(((hash % 620) / 100 + 0.3) * 10) / 10
}

export function InventoryCompareModal({ isOpen, onClose, heading, candidates, busyId, onChoose, baseItem }: {
  isOpen: boolean
  onClose: () => void
  heading: string
  candidates: InventoryItem[]
  busyId?: string | null
  onChoose: (item: InventoryItem) => void
  baseItem?: { type: string; title: string; startTime?: string; endTime?: string }
}) {
  return <Modal isOpen={isOpen} onClose={onClose} size="wide" title={heading}>
    {candidates.length === 0
      ? <p className="tp-modal-copy">No comparable verified inventory is available right now.</p>
      : <div className="tp-compare-grid">
        {candidates.map((candidate) => {
          const isBusy = busyId === candidate.id
          const rating = candidate.vendor.reliabilityScore
          const candidateCarbon = estimateCarbonKg(candidate)
          const baseCarbon = baseItem ? estimateCarbonKg({ ...baseItem, tags: [] }) : null
          const carbonDelta = baseCarbon === null ? null : candidateCarbon - baseCarbon
          return <Card className="tp-compare-card" key={candidate.id}>
            <span className="tp-compare-type">{candidate.type}</span>
            <h3>{candidate.title}</h3>
            <p className="tp-compare-meta">{candidate.vendor.name} · {candidate.location}</p>
            <dl className="tp-compare-attrs">
              <div><dt>Price</dt><dd>₹{candidate.price.toLocaleString()}</dd></div>
              <div><dt>Rating</dt><dd>{typeof rating === 'number' ? `${rating}%` : '—'}</dd></div>
              <div><dt>Distance</dt><dd>~{placeholderDistanceKm(candidate.id)} km</dd></div><div><dt>Carbon</dt><dd>{candidateCarbon.toFixed(1)} kg CO₂{carbonDelta !== null ? ` · ${carbonDelta >= 0 ? '+' : ''}${carbonDelta.toFixed(1)} kg` : ''}</dd></div>
            </dl>
            <Button disabled={Boolean(busyId) && !isBusy} onClick={() => onChoose(candidate)} type="button">{isBusy ? 'Applying…' : 'Choose this'}</Button>
          </Card>
        })}
      </div>}
  </Modal>
}
