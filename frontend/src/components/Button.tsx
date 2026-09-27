import type { ButtonHTMLAttributes, ReactNode } from 'react'
type Variant = 'primary' | 'secondary' | 'ghost'
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: Variant }
export function Button({ children, className = '', variant = 'primary', ...props }: Props) { return <button className={`tp-button tp-button-${variant} ${className}`} {...props}>{children}</button> }
