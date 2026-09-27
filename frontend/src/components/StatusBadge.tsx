type Status = 'confirmed' | 'at-risk' | 'cancelled' | 'pending'
const labels: Record<Status, string> = { confirmed: 'Confirmed', 'at-risk': 'At risk', cancelled: 'Cancelled', pending: 'Pending' }
export function StatusBadge({ status }: { status: Status }) { return <span className={`tp-status tp-status-${status}`}>{labels[status]}</span> }
