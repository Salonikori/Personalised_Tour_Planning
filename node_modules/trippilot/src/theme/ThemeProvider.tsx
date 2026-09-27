import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
export type Theme = 'light' | 'dark'
type ThemeContextValue = { theme: Theme; toggleTheme: () => void; setTheme: (theme: Theme) => void }
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
const storageKey = 'trippilot-theme'
function getInitialTheme(): Theme { const saved = localStorage.getItem(storageKey); return saved === 'dark' || saved === 'light' ? saved : 'light' }
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem(storageKey, theme) }, [theme])
  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')
  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>
}
export function useTheme() { const context = useContext(ThemeContext); if (!context) throw new Error('useTheme must be used inside a ThemeProvider'); return context }
