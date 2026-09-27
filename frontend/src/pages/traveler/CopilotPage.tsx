import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { activeAffectedItem, activeTrip, approveRecovery, notifyTripUpdated, sendCopilotMessage, swapItineraryItem, type CopilotResponse } from '../../services/tripService'

type Message = { id: number; role: 'assistant' | 'user'; text: string; response?: CopilotResponse }
export function CopilotPage() {
  const { t } = useTranslation()
  const suggestions = [t('copilot.suggestions.0'), t('copilot.suggestions.1'), t('copilot.suggestions.2'), t('copilot.suggestions.3')]
  const [messages, setMessages] = useState<Message[]>([{ id: 1, role: 'assistant', text: t('copilot.initial') }])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState('')
  const send = async (message = draft) => {
    const text = message.trim(); if (!text || typing) return
    const tripId = activeTrip.get(); if (!tripId) { setError(t('copilot.createTrip')); return }
    setMessages((current) => [...current, { id: Date.now(), role: 'user', text }]); setDraft(''); setTyping(true); setError('')
    try {
      const response = await sendCopilotMessage(tripId, text, i18n.language, messages.map((entry) => ({ role: entry.role, text: entry.text })))
      if (response.structuredData.recovery) activeAffectedItem.set(response.structuredData.recovery.affectedItemId)
      setMessages((current) => [...current, { id: Date.now() + 1, role: 'assistant', text: response.message, response }]); notifyTripUpdated()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('copilot.unavailable')) } finally { setTyping(false) }
  }
  const applyRecovery = async (planId: string) => { try { setApplying(planId); await approveRecovery(planId); setMessages((current) => [...current, { id: Date.now(), role: 'assistant', text: t('copilot.sentApproval') }]) } catch (reason) { setError(reason instanceof Error ? reason.message : t('copilot.applyRecoveryError')) } finally { setApplying(null) } }
  const applyHotel = async (itemId: string, inventoryId: string) => { try { setApplying(inventoryId); await swapItineraryItem(itemId, inventoryId); notifyTripUpdated(); setMessages((current) => [...current, { id: Date.now(), role: 'assistant', text: t('copilot.hotelApplied') }]) } catch (reason) { setError(reason instanceof Error ? reason.message : t('copilot.applyHotelError')) } finally { setApplying(null) } }
  return <section className="copilot-page"><header className="copilot-heading"><p className="eyebrow">{t('copilot.eyebrow')}</p><h1 className="page-title">{t('copilot.title')}</h1><p className="page-copy">{t('copilot.copy')}</p></header><Card className="copilot-chat"><div aria-live="polite" className="copilot-messages">{messages.map((message) => <article className={`copilot-message is-${message.role}`} key={message.id}><span className="copilot-avatar">{message.role === 'assistant' ? '✦' : 'You'}</span><div className="copilot-bubble"><p>{message.text}</p>{message.response?.structuredData.recovery?.plans.map((plan, index) => <Card className="copilot-recovery" key={plan.id}><span>{t('copilot.recoveryOption')} #{index + 1}</span><h2>{index === 0 ? t('copilot.best') : index === 1 ? t('copilot.balanced') : t('copilot.fallback')}</h2><p>{plan.explanation}</p><strong>{plan.extraCost >= 0 ? '+' : ''}₹{plan.extraCost.toLocaleString()} · +{plan.timeDelta} min · {plan.preferenceScore}% match · {plan.vendorReliability}% reliable</strong><Button disabled={applying !== null} onClick={() => void applyRecovery(plan.id)} type="button">{applying === plan.id ? t('copilot.applying') : t('copilot.apply')}</Button></Card>)}{message.response?.structuredData.alternatives?.map((alternative) => <Card className="copilot-recovery" key={alternative.id}><span>{t('copilot.verifiedAlternative')}</span><h2>{alternative.title}</h2><p>{alternative.location} · {alternative.vendor}</p><strong>₹{alternative.cost.toLocaleString()} · {alternative.reliability}% reliable</strong><Button disabled={applying !== null || !message.response?.structuredData.itemId} onClick={() => void applyHotel(message.response!.structuredData.itemId!, alternative.id)} type="button">{applying === alternative.id ? t('copilot.applying') : t('copilot.apply')}</Button></Card>)}{message.response?.structuredData.nextItems?.map((item) => <Card className="copilot-recovery" key={item.id}><span>{t('copilot.upcoming')}</span><h2>{item.title}</h2><p>{new Date(item.startTime).toLocaleString()} · {item.location}</p><strong>₹{item.cost.toLocaleString()}</strong></Card>)}</div></article>)}{typing && <article className="copilot-message is-assistant"><span className="copilot-avatar">✦</span><div className="copilot-bubble copilot-typing"><i /><i /><i /></div></article>}</div><div className="copilot-compose">{error && <p className="auth-error">{error}</p>}<div className="copilot-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)} type="button">{suggestion}</button>)}</div><div className="copilot-input-row"><input aria-label={t('copilot.messageLabel')} className="tp-input" disabled={typing} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send() }} placeholder={t('copilot.placeholder')} value={draft} /><Button disabled={typing} onClick={() => void send()} type="button">{t('copilot.send')}</Button></div></div></Card></section>
}
