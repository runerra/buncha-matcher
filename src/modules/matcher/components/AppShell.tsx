import { Box, Typography, IconButton } from '@mui/material'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import { useAppTheme } from '../theme/ThemeContext'
import type { ReactNode } from 'react'

export function AppShell({ children }: { children: ReactNode }) {
  const { mode, toggle, tokens: t } = useAppTheme()

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: t.bg.primary,
        color: t.text.primary,
        transition: 'background-color 0.2s, color 0.2s',
      }}
    >
      {/* Content area */}
      <Box sx={{ maxWidth: 880, mx: 'auto', px: 3, py: 3 }}>
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: '1.125rem',
                letterSpacing: '-0.02em',
                color: t.text.primary,
              }}
            >
              The Matcher
            </Typography>
            <Box
              sx={{
                px: 1.25,
                py: 0.4,
                border: `1px solid ${t.border.default}`,
                borderRadius: 20,
                fontSize: '0.75rem',
                color: t.text.secondary,
                fontWeight: 500,
              }}
            >
              {dateStr} · {timeStr}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                px: 1.25,
                py: 0.4,
                border: `1px solid ${t.border.default}`,
                borderRadius: 20,
                fontSize: '0.75rem',
                color: t.text.secondary,
                fontWeight: 500,
              }}
            >
              V1 · Ops approves all actions
            </Box>
            <IconButton
              onClick={toggle}
              size="small"
              sx={{
                color: t.text.tertiary,
                '&:hover': { bgcolor: t.bg.secondary },
              }}
            >
              {mode === 'light' ? <DarkModeIcon sx={{ fontSize: 18 }} /> : <LightModeIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Box>
        </Box>

        {children}
      </Box>
    </Box>
  )
}
