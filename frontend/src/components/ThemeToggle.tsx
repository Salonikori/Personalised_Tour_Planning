import { useTheme } from '../theme/ThemeProvider'
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme(); const nextTheme = theme === 'light' ? 'dark' : 'light'
  return <button aria-label={`Switch to ${nextTheme} theme`} className="theme-toggle" onClick={toggleTheme} title={`Switch to ${nextTheme} theme`} type="button"><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span></button>
}
