import { useState } from 'react'
import { Card } from '../Card'
import { Button } from '../Button'

export type TwinCopilotQA = { id: string; question: string; answer: string }

type Message = { id: string; role: 'assistant' | 'user'; text: string }

interface TwinCopilotPanelProps {
  heading?: string
  intro?: string
  qas: TwinCopilotQA[]
  placeholder?: string
  fallback?: string
}

/**
 * A self-contained, right-hand "copilot" chat panel for the digital twin pages.
 * It ships with a fixed set of default questions and prepared answers (computed
 * by the parent page from the live twin/scenario state) so it works instantly,
 * with no extra network round-trip. Free-typed questions are matched against
 * the same prepared answers by keyword overlap; anything unmatched gets an
 * honest fallback instead of a fabricated answer.
 */
export function TwinCopilotPanel({
  heading = 'Twin Copilot',
  intro = 'Ask about this simulation - here are a few to start with.',
  qas,
  placeholder = 'Ask the twin copilot…',
  fallback = "I don't have a prepared answer for that yet. Try one of the suggestions above, or open the full Copilot for a deeper, live-reasoned answer.",
}: TwinCopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([{ id: 'greet', role: 'assistant', text: intro }])
  const [draft, setDraft] = useState('')
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set())

  const findAnswer = (raw: string): string => {
    const norm = raw.trim().toLowerCase()
    if (!norm) return fallback
    const exact = qas.find((qa) => qa.question.trim().toLowerCase() === norm)
    if (exact) return exact.answer
    const words = norm.split(/[^a-z0-9]+/).filter((w) => w.length > 3)
    let best: { qa: TwinCopilotQA; score: number } | null = null
    for (const qa of qas) {
      const qWords = qa.question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
      const score = words.filter((w) => qWords.includes(w)).length
      if (score > 0 && (!best || score > best.score)) best = { qa, score }
    }
    return best ? best.qa.answer : fallback
  }

  const ask = (question: string, matchedId?: string) => {
    const text = question.trim()
    if (!text) return
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text }
    const answer = matchedId ? qas.find((qa) => qa.id === matchedId)?.answer ?? fallback : findAnswer(text)
    const botMsg: Message = { id: `a-${Date.now() + 1}`, role: 'assistant', text: answer }
    setMessages((current) => [...current, userMsg, botMsg])
    if (matchedId) setAskedIds((current) => new Set(current).add(matchedId))
    setDraft('')
  }

  return (
    <Card className="twin-copilot-panel">
      <div className="twin-copilot-head">
        <span className="twin-copilot-badge">✦ Live on this simulation</span>
        <h2>{heading}</h2>
      </div>
      <div className="twin-copilot-messages" aria-live="polite">
        {messages.map((message) => (
          <article className={`twin-copilot-message is-${message.role}`} key={message.id}>
            <span className="twin-copilot-avatar">{message.role === 'assistant' ? '✦' : 'You'}</span>
            <div className="twin-copilot-bubble"><p>{message.text}</p></div>
          </article>
        ))}
      </div>
      <div className="twin-copilot-quick">
        {qas.map((qa) => (
          <button
            className={askedIds.has(qa.id) ? 'is-asked' : ''}
            key={qa.id}
            onClick={() => ask(qa.question, qa.id)}
            type="button"
          >
            {qa.question}
          </button>
        ))}
      </div>
      <div className="twin-copilot-input-row">
        <input
          aria-label="Ask the twin copilot a question"
          className="tp-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') ask(draft) }}
          placeholder={placeholder}
          value={draft}
        />
        <Button onClick={() => ask(draft)} type="button">Ask</Button>
      </div>
    </Card>
  )
}
