import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react'
import { createTheme, ThemeProvider as MuiThemeProvider } from '@mui/material/styles'
import { tokens, type ThemeTokens } from './tokens'

type Mode = 'light' | 'dark'

interface ThemeContextValue {
  mode: Mode
  toggle: () => void
  tokens: ThemeTokens
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useAppTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useAppTheme must be inside ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('light')
  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), [])
  const t = tokens[mode]

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          background: {
            default: t.bg.primary,
            paper: t.bg.elevated,
          },
          text: {
            primary: t.text.primary,
            secondary: t.text.secondary,
          },
          divider: t.border.default,
          primary: {
            main: t.accent.primary,
          },
        },
        typography: {
          fontFamily:
            '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          h5: { fontWeight: 600, fontSize: '1.125rem', letterSpacing: '-0.01em' },
          h6: { fontWeight: 600, fontSize: '0.9375rem', letterSpacing: '-0.005em' },
          body1: { fontSize: '0.875rem', lineHeight: 1.6 },
          body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
          caption: { fontSize: '0.75rem', lineHeight: 1.4 },
        },
        shape: { borderRadius: 6 },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: t.bg.primary,
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.8125rem',
                borderRadius: 20,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              },
              sizeSmall: {
                padding: '5px 16px',
                fontSize: '0.8125rem',
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                fontWeight: 600,
                fontSize: '0.6875rem',
                height: 22,
                borderRadius: 4,
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
              },
            },
          },
        },
      }),
    [mode, t],
  )

  const value = useMemo(() => ({ mode, toggle, tokens: t }), [mode, toggle, t])

  return (
    <ThemeContext.Provider value={value}>
      <MuiThemeProvider theme={muiTheme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  )
}
