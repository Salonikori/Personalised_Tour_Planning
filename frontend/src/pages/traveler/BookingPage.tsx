import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import { activeTrip, checkoutTrip, getItinerary, getTrip, notifyTripUpdated, verifyCheckoutPayment, type ApiItem, type ApiTrip, type CheckoutConfirmation } from '../../services/tripService'

// Lazily loads Razorpay's Checkout widget script once per page - only needed when the backend is
// running with PAYMENT_PROVIDER=razorpay, so most deployments never fetch this at all.
function loadRazorpayCheckout(): Promise<void> {
  const existing = document.getElementById('razorpay-checkout-js')
  if (existing) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.id = 'razorpay-checkout-js'; script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Unable to load the Razorpay checkout script.')); document.body.appendChild(script)
  })
}

export function BookingPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ApiItem[]>([]); const [confirmation, setConfirmation] = useState<CheckoutConfirmation | null>(null); const [loading, setLoading] = useState(false)
  const [trip, setTrip] = useState<ApiTrip | null>(null); const [error, setError] = useState(''); const tripId = activeTrip.get()
  useEffect(() => { if (tripId) { void getTrip(tripId).then(setTrip).catch(() => undefined); void getItinerary(tripId).then(setItems).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load checkout.')) } }, [tripId])
  const confirm = async () => {
    if (!tripId) return setError('Create or generate a trip before checkout.')
    try {
      setLoading(true); setError('')
      const result = await checkoutTrip(tripId)
      if (result.status === 'paid') { setConfirmation(result.confirmation); notifyTripUpdated(); setLoading(false); return }
      // Razorpay: complete payment with the real test-mode Checkout widget, then verify server-side.
      await loadRazorpayCheckout()
      const razorpay = new (window as unknown as { Razorpay: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay({
        key: result.checkout.keyId,
        amount: result.checkout.amount,
        currency: result.checkout.currency,
        order_id: result.checkout.orderId,
        name: 'TripPilot',
        description: 'Trip checkout',
        handler: (paymentResponse: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          void verifyCheckoutPayment(tripId, { orderId: paymentResponse.razorpay_order_id, paymentId: paymentResponse.razorpay_payment_id, signature: paymentResponse.razorpay_signature })
            .then((next) => { setConfirmation(next); notifyTripUpdated() })
            .catch((reason) => setError(reason instanceof Error ? reason.message : 'Payment could not be verified.'))
            .finally(() => setLoading(false))
        },
        modal: { ondismiss: () => setLoading(false) },
      })
      razorpay.open()
      return
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete checkout.') }
    setLoading(false)
  }
  if (confirmation) return <section className="booking-page"><p className="eyebrow">Booking confirmed</p><h1 className="page-title">{confirmation.destination} is officially on.</h1><Card className="boarding-pass"><div className="boarding-main"><div><span>Traveler</span><strong>{confirmation.traveler.name}</strong></div><div><span>Destination</span><strong>{confirmation.destination}</strong></div><div><span>Dates</span><strong>{new Date(confirmation.startDate).toLocaleDateString()} – {new Date(confirmation.endDate).toLocaleDateString()}</strong></div><div><span>Payment</span><strong>Paid</strong></div></div><div className="boarding-stub"><span>TRIPPILOT</span><strong>✓</strong><small>{confirmation.bookings.length} booking ID{confirmation.bookings.length === 1 ? '' : 's'} created</small></div></Card><Card className="booking-success"><StatusBadge status="confirmed" /><h2>Everything is reserved.</h2><p>Total paid: ₹{confirmation.totalCost.toLocaleString()}</p><div className="wallet-table">{confirmation.itinerary.map((item) => { const booking = confirmation.bookings.find((entry) => entry.itineraryItemId === item.id); return <div className="wallet-line" key={item.id}><div><strong>{item.vendor}</strong><span>{item.title} · {booking ? `ID ${booking.id.slice(-8)} · ${booking.paymentStatus}` : 'Paid'}</span></div><strong>₹{item.amount.toLocaleString()}</strong><StatusBadge status="confirmed" /></div> })}</div><Button onClick={() => navigate('/traveler/today')} type="button">Go to Live Trip</Button></Card></section>
  const total = items.reduce((sum, item) => sum + item.cost, 0)
  if (trip && trip.approvalStatus !== 'APPROVED') return <section className="page-stack"><Card><p className="eyebrow">Payment locked</p><h1 className="page-title">Your trip is not approved yet.</h1><p className="page-copy">{trip.adminFeedback || 'An admin must approve the finalized itinerary before payment becomes available.'}</p><Button onClick={() => window.location.href='/traveler/composer'} type="button">Back to itinerary</Button></Card></section>
  return <section className="booking-page"><p className="eyebrow">Checkout</p><h1 className="page-title">One last look.</h1><p className="page-copy">Your selected trip elements are ready for simulated multi-vendor checkout.</p><div className="booking-layout"><Card className="booking-summary"><h2>Order summary</h2>{items.map((item) => <div className="booking-item" key={item.id}><span>{item.title} · {item.vendor?.name || 'Verified vendor'}</span><strong>₹{item.cost.toLocaleString()}</strong></div>)}<div className="booking-total"><span>Total</span><strong>₹{total.toLocaleString()}</strong></div><Button disabled={loading || !items.length} onClick={() => void confirm()} type="button">{loading ? 'Confirming…' : 'Confirm & Pay'}</Button>{error && <p className="auth-error">{error}</p>}</Card><Card className="booking-note"><span>Protected booking</span><h2>Designed to flex.</h2><p>Checkout creates one paid booking per itinerary item. Any recovery cancellation is captured in the payment audit trail.</p></Card></div></section>
}
