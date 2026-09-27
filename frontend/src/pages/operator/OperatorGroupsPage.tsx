import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { OperatorLayout } from '../../layouts/OperatorLayout'
import { getOperatorTrips, type OperatorTrip } from '../../services/operatorService'
import {
  addParticipant,
  assignCoordinator,
  createGroup,
  getGroup,
  getGroups,
  getUsersByRole,
  type DirectoryUser,
  type GroupParticipantStatus,
  type TourGroup,
} from '../../services/groupService'

const participantStatus: Record<GroupParticipantStatus, 'confirmed' | 'pending' | 'cancelled'> = { CONFIRMED: 'confirmed', INVITED: 'pending', DECLINED: 'cancelled' }

export function OperatorGroupsPage() {
  const [groups, setGroups] = useState<TourGroup[]>([])
  const [trips, setTrips] = useState<OperatorTrip[]>([])
  const [coordinators, setCoordinators] = useState<DirectoryUser[]>([])
  const [travelers, setTravelers] = useState<DirectoryUser[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [newTripId, setNewTripId] = useState('')
  const [newName, setNewName] = useState('')
  const [newCoordinatorId, setNewCoordinatorId] = useState('')
  const [saving, setSaving] = useState(false)

  const [addTravelerId, setAddTravelerId] = useState('')
  const [addingParticipant, setAddingParticipant] = useState(false)
  const [reassigning, setReassigning] = useState(false)

  const load = async () => {
    try {
      setLoading(true); setError('')
      const [groupList, tripList, coordinatorList, travelerList] = await Promise.all([getGroups(), getOperatorTrips(), getUsersByRole('COORDINATOR'), getUsersByRole('TRAVELER')])
      setGroups(groupList); setTrips(tripList.trips); setCoordinators(coordinatorList); setTravelers(travelerList)
      setSelectedId((current) => current && groupList.some((group) => group.id === current) ? current : groupList[0]?.id ?? null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load groups.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const selected = useMemo(() => groups.find((group) => group.id === selectedId) ?? null, [groups, selectedId])

  const refreshSelected = async (groupId: string) => {
    const group = await getGroup(groupId)
    setGroups((current) => current.map((item) => item.id === group.id ? group : item))
  }

  const save = async () => {
    if (!newTripId || newName.trim().length < 2) return setError('Pick a trip and give the group a name (2+ characters).')
    try {
      setSaving(true); setError('')
      const group = await createGroup({ tripId: newTripId, name: newName.trim(), coordinatorId: newCoordinatorId || null })
      setGroups((current) => [group, ...current]); setSelectedId(group.id)
      setNewTripId(''); setNewName(''); setNewCoordinatorId(''); setModalOpen(false); setSuccess(`${group.name} was created.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create group.') } finally { setSaving(false) }
  }

  const reassign = async (coordinatorId: string) => {
    if (!selected) return
    try { setReassigning(true); setError(''); await assignCoordinator(selected.id, coordinatorId || null); await refreshSelected(selected.id); setSuccess('Coordinator updated.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to assign coordinator.') } finally { setReassigning(false) }
  }

  const addTraveler = async () => {
    if (!selected || !addTravelerId) return
    try { setAddingParticipant(true); setError(''); await addParticipant(selected.id, addTravelerId); await refreshSelected(selected.id); setAddTravelerId(''); setSuccess('Traveler added to the group.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to add traveler.') } finally { setAddingParticipant(false) }
  }

  return <OperatorLayout>
    <section className="operator-page">
      <header className="operator-page-heading">
        <div><p className="eyebrow">Group tours</p><h1>Coordinate shared itineraries.</h1><p>Assign a coordinator and track who has confirmed onto each group's itinerary.</p></div>
        <Button onClick={() => { setSuccess(''); setModalOpen(true) }} type="button">Create Group</Button>
      </header>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {success && <p className="auth-inline-message" role="status">{success}</p>}
      {loading && <p className="page-copy">Loading groups…</p>}
      {!loading && !error && groups.length === 0 && <p className="page-copy">No tour groups yet. Create one from an existing trip.</p>}
      {!loading && groups.length > 0 && <div className="operator-groups-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <Card className="operator-table-card">
          <div className="operator-table-head"><span>Group</span><span>Destination</span></div>
          {groups.map((group) => <button className="operator-table-row" key={group.id} onClick={() => setSelectedId(group.id)} style={{ width: '100%', textAlign: 'left', background: group.id === selectedId ? 'var(--tp-surface-active, rgba(99,102,241,0.08))' : undefined, border: 'none', cursor: 'pointer' }} type="button">
            <strong>{group.name}</strong>
            <span>{group.trip.destination}</span>
          </button>)}
        </Card>

        {selected && <Card className="operator-table-card">
          <h2 style={{ marginTop: 0 }}>{selected.name}</h2>
          <p className="page-copy">{selected.trip.destination} · {new Date(selected.trip.startDate).toLocaleDateString()} – {new Date(selected.trip.endDate).toLocaleDateString()} · Trip status {selected.trip.status}</p>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', margin: '1rem 0' }}>
            <label className="tp-input-wrap"><span className="tp-input-label">Coordinator</span>
              <select className="tp-input" disabled={reassigning} onChange={(event) => void reassign(event.target.value)} value={selected.coordinator?.id ?? ''}>
                <option value="">Unassigned</option>
                {coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name} ({coordinator.email})</option>)}
              </select>
            </label>
          </div>

          <h3>Participants</h3>
          <div className="operator-table-head"><span>Traveler</span><span>Itinerary status</span></div>
          {selected.participants.length === 0 && <p className="page-copy">No travelers added yet.</p>}
          {selected.participants.map((participant) => <div className="operator-table-row" key={participant.id}>
            <span><strong>{participant.user.name}</strong><br /><small>{participant.user.email}</small></span>
            <StatusBadge status={participantStatus[participant.itineraryStatus]} />
          </div>)}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginTop: '1rem' }}>
            <label className="tp-input-wrap" style={{ flex: 1 }}><span className="tp-input-label">Add traveler</span>
              <select className="tp-input" onChange={(event) => setAddTravelerId(event.target.value)} value={addTravelerId}>
                <option value="">Choose a traveler…</option>
                {travelers.filter((traveler) => !selected.participants.some((participant) => participant.user.id === traveler.id)).map((traveler) => <option key={traveler.id} value={traveler.id}>{traveler.name} ({traveler.email})</option>)}
              </select>
            </label>
            <Button disabled={!addTravelerId || addingParticipant} onClick={() => void addTraveler()} type="button">{addingParticipant ? 'Adding…' : 'Add'}</Button>
          </div>
        </Card>}
      </div>}

      <Modal isOpen={modalOpen} onClose={() => !saving && setModalOpen(false)} title="Create group">
        <div className="vendor-form">
          <label className="tp-input-wrap"><span className="tp-input-label">Trip</span>
            <select className="tp-input" onChange={(event) => setNewTripId(event.target.value)} value={newTripId}>
              <option value="">Choose a trip…</option>
              {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.destination} — {trip.traveler.name}</option>)}
            </select>
          </label>
          <Input label="Group name" onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Kyoto Autumn Group" required value={newName} />
          <label className="tp-input-wrap"><span className="tp-input-label">Coordinator (optional)</span>
            <select className="tp-input" onChange={(event) => setNewCoordinatorId(event.target.value)} value={newCoordinatorId}>
              <option value="">Unassigned</option>
              {coordinators.map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.name} ({coordinator.email})</option>)}
            </select>
          </label>
          <Button disabled={saving} onClick={() => void save()} type="button">{saving ? 'Creating group…' : 'Create group'}</Button>
        </div>
      </Modal>
    </section>
  </OperatorLayout>
}
