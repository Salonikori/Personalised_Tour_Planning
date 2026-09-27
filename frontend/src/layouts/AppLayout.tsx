import type { ReactNode } from 'react'
import { ThemeToggle } from '../components/ThemeToggle'

export function AppLayout({ children }: { children: ReactNode }) {
  return <div className="app-shell min-h-screen">{children}<ThemeToggle /></div>
}
