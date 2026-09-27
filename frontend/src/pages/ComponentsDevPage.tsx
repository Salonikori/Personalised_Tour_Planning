import { useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ChipSelector } from '../components/ChipSelector'
import { Input } from '../components/Input'
import { Modal } from '../components/Modal'
import { SegmentedControl } from '../components/SegmentedControl'
import { Slider } from '../components/Slider'
import { StatusBadge } from '../components/StatusBadge'
import { Tabs } from '../components/Tabs'

const tabItems = [{ id: 'overview', label: 'Overview' }, { id: 'journey', label: 'Journey' }, { id: 'activity', label: 'Activity' }]
const segmentItems = [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' }]
const chipItems = [{ id: 'flight', label: 'Flight' }, { id: 'hotel', label: 'Hotel' }, { id: 'rail', label: 'Rail' }]

export function ComponentsDevPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [segment, setSegment] = useState('week')
  const [chips, setChips] = useState<string[]>(['flight'])
  const toggleChip = (id: string) => setChips((selected) => selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  return <section className="tp-dev-page"><p className="eyebrow">Component library</p><h1 className="page-title">Component check</h1><p className="page-copy">Every component below uses the shared theme properties. Use the fixed toggle to inspect both themes.</p>
    <div className="tp-dev-grid">
      <Card><h2>Buttons</h2><div className="tp-example-row"><Button>Primary action</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button></div></Card>
      <Card><h2>Status badges</h2><div className="tp-example-row"><StatusBadge status="confirmed" /><StatusBadge status="at-risk" /><StatusBadge status="cancelled" /><StatusBadge status="pending" /></div></Card>
      <Card><h2>Input</h2><Input hint="Helper text can explain the field." label="Destination" name="destination" placeholder="Where to?" /></Card>
      <Card><h2>Modal</h2><Button onClick={() => setModalOpen(true)}>Open modal</Button></Card>
      <Card><h2>Tabs</h2><Tabs activeId={activeTab} onChange={setActiveTab} tabs={tabItems} /><p className="tp-example-value">Selected: {activeTab}</p></Card>
      <Card><h2>Segmented control</h2><SegmentedControl onChange={setSegment} options={segmentItems} value={segment} /><p className="tp-example-value">Selected: {segment}</p></Card>
      <Card><h2>Slider</h2><Slider defaultValue={60} label="Trip flexibility" max="100" min="0" /></Card>
      <Card><h2>Chip selector</h2><ChipSelector chips={chipItems} onChange={toggleChip} selected={chips} /></Card>
    </div>
    <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Shared modal"><p className="tp-modal-copy">This dialog inherits its surface, type, border, and shadow from the active theme.</p><Button onClick={() => setModalOpen(false)}>Done</Button></Modal>
  </section>
}
