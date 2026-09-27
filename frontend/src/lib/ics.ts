import type { ApiItem, ApiTrip } from '../services/tripService'

// Minimal RFC 5545 escaping for TEXT values (COMMA, SEMICOLON, BACKSLASH, and
// newlines all need escaping inside ICS text fields).
function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// Local ICS DATE-TIME values are written in UTC (trailing Z) so every calendar
// app renders them the same way regardless of the reader's timezone.
function toIcsDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

// Long lines must be "folded" at 75 octets per RFC 5545 (a CRLF followed by a
// single leading space continues the line).
function foldLine(line: string) {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75))
    rest = ' ' + rest.slice(75)
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

export function buildItineraryIcs(trip: ApiTrip | null, items: ApiItem[]) {
  const confirmed = items.filter((item) => item.status === 'CONFIRMED')
  const stamp = toIcsDate(new Date().toISOString())
  const calName = trip?.destination ? `TripPilot - ${trip.destination}` : 'TripPilot Itinerary'

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TripPilot//Itinerary Export//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calName)}`,
    ...confirmed.map((item) => [
      'BEGIN:VEVENT',
      `UID:${item.id}@trippilot`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDate(item.startTime)}`,
      `DTEND:${toIcsDate(item.endTime)}`,
      `SUMMARY:${escapeText(item.title)}`,
      `LOCATION:${escapeText(item.location)}`,
      ...(item.vendor?.name ? [`DESCRIPTION:${escapeText(item.vendor.name)}`] : []),
      'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ]

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function downloadItineraryIcs(trip: ApiTrip | null, items: ApiItem[]) {
  const content = buildItineraryIcs(trip, items)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const slug = (trip?.destination || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'trip'
  anchor.href = url
  anchor.download = `${slug}-itinerary.ics`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
