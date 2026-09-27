import type { InputHTMLAttributes } from 'react'
type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }
export function Input({ className = '', hint, id, label, ...props }: Props) { const inputId = id ?? props.name; return <label className="tp-input-wrap" htmlFor={inputId}><span className="tp-input-label">{label}</span><input className={`tp-input ${className}`} id={inputId} {...props} />{hint && <span className="tp-input-hint">{hint}</span>}</label> }
