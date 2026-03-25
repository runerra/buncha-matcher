import { Box, Typography } from '@mui/material'
import { useAppTheme } from '../theme/ThemeContext'
import type { StoreWindowHealth } from '../data/mock'

interface SummaryCountersProps {
  storeHealth: StoreWindowHealth[]
  needsAction: number
  reopenedToday: number
  ordersSaved: number
}

export function SummaryCounters({ storeHealth, needsAction, reopenedToday, ordersSaved }: SummaryCountersProps) {
  const { tokens: t } = useAppTheme()

  const allWindows = storeHealth.flatMap((store) => store.windows)
  const atRisk = allWindows.filter((w) => w.health === 'at_risk' || w.health === 'gap').length
  const totalWindows = allWindows.length
  const openWindows = allWindows.filter((w) => w.isOpen).length

  const counters = [
    { label: 'Windows at risk', value: String(atRisk), warn: atRisk > 0 },
    { label: 'Needs action', value: String(needsAction), warn: needsAction > 0 },
    { label: 'Windows open', value: `${openWindows} / ${totalWindows}` },
    { label: 'Reopened today', value: String(reopenedToday), good: reopenedToday > 0 },
    { label: 'Orders saved', value: String(ordersSaved), good: ordersSaved > 0 },
  ]

  return (
    <Box sx={{ display: 'flex', gap: 1.5 }}>
      {counters.map((c) => (
        <Box
          key={c.label}
          sx={{
            flex: 1,
            bgcolor: t.bg.secondary,
            border: `1px solid ${t.border.default}`,
            borderRadius: 1,
            px: 2,
            py: 1.5,
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: t.text.secondary, mb: 0.5 }}
          >
            {c.label}
          </Typography>
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '1.5rem',
              color: c.warn ? t.urgency.sameDay : c.good ? t.accent.primary : t.text.primary,
            }}
          >
            {c.value}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
