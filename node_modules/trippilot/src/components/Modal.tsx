import type { ReactNode } from 'react'
import { Button } from './Button'
export function Modal({ children, isOpen, onClose, title, size = 'default' }: { children: ReactNode; isOpen: boolean; onClose: () => void; title: string; size?: 'default' | 'wide' }) {
  if (!isOpen) return null
  return <div aria-modal="true" className="tp-modal-backdrop" onMouseDown={onClose} role="dialog"><section className={`tp-modal ${size === 'wide' ? 'tp-modal-wide' : ''}`} onMouseDown={(event) => event.stopPropagation()}><div className="tp-modal-header"><h2>{title}</h2><Button aria-label="Close modal" onClick={onClose} variant="ghost">×</Button></div><div>{children}</div></section></div>
}
