import { useState } from 'react'
import { Box, Typography, Tooltip } from '@mui/material'
import { useAppTheme } from '../theme/ThemeContext'
import type { StoreWindowHealth, WindowHealth } from '../data/mock'

function healthColor(health: WindowHealth) {
  switch (health) {
    case 'covered': return { bg: '#D1E7D8', border: '#A8D5B8', text: '#3B6B4A' }
    case 'at_risk': return { bg: '#F5E6C8', border: '#E8D1A0', text: '#8B6914' }
    case 'gap': return { bg: '#F0C4C0', border: '#E09A95', text: '#8B3A35' }
  }
}

function healthLabel(health: WindowHealth) {
  switch (health) {
    case 'covered': return 'Covered'
    case 'at_risk': return 'At risk'
    case 'gap': return 'Gap'
  }
}

/** Convert time label like "9a–11a" or "1p–3p" to 24hr number for sorting */
function timeTo24(time: string): number {
  const match = time.match(/^(\d+)(a|p)?/)
  if (!match) return 0
  let h = parseInt(match[1])
  const ampm = match[2]
  if (ampm === 'p' && h !== 12) h += 12
  if (ampm === 'a' && h === 12) h = 0
  // Handle pure numeric like "10–12"
  if (!ampm) return h
  return h
}

function displayStoreName(name: string): string {
  return name
    .replace(/^\d+-\s*/, '')
    .replace(/^Meijer\s*/i, '')
    .trim()
}

export function StoreHealthGrid({ stores }: { stores: StoreWindowHealth[] }) {
  const { tokens: t } = useAppTheme()
  const [hideCovered, setHideCovered] = useState(false)

  if (stores.length === 0) return null

  // Collect all unique time slots across all stores, sorted chronologically
  const allTimeSlots = [...new Set(stores.flatMap((s) => s.windows.map((w) => w.time)))]
    .sort((a, b) => timeTo24(a) - timeTo24(b))

  // Filter covered windows if toggled
  const visibleStores = hideCovered
    ? stores
        .map((s) => ({ ...s, windows: s.windows.filter((w) => w.health !== 'covered') }))
        .filter((s) => s.windows.length > 0)
    : stores

  const hasIssues = stores.some((s) => s.windows.some((w) => w.health !== 'covered'))

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
        <Box sx={{ width: 120, flexShrink: 0 }} />
        <Box sx={{ display: 'flex', gap: 0.5, flex: 1 }}>
          {allTimeSlots.map((time) => (
            <Box key={time} sx={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.625rem',
                  color: t.text.tertiary,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {time}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Rows */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {visibleStores.map((store) => {
          const windowByTime = new Map(store.windows.map((w) => [w.time, w]))
          return (
            <Box key={store.storeId} sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography
                sx={{
                  width: 120,
                  flexShrink: 0,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: t.text.primary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  pr: 1.5,
                }}
              >
                {displayStoreName(store.storeName)}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flex: 1 }}>
                {allTimeSlots.map((time) => {
                  const win = windowByTime.get(time)
                  if (!win) return <Box key={time} sx={{ flex: 1, height: 32 }} />

                  const colors = healthColor(win.health)
                  const tipLines: string[] = [`${displayStoreName(store.storeName)} ${time} — ${win.atOrderCap ? 'Full' : healthLabel(win.health)}`]
                  tipLines.push(`${win.orders} orders · ${win.units}/${win.maxCapacity} units`)
                  if (win.units > win.maxCapacity) tipLines.push(`${win.units - win.maxCapacity} units over capacity`)
                  else tipLines.push(`Remaining capacity: ${win.maxCapacity - win.units} units`)
                  if (!win.driverOk) tipLines.push('Driver missing')
                  if (win.atOrderCap) tipLines.push('Order cap reached')
                  return (
                    <Tooltip
                      key={win.id}
                      title={tipLines.join('\n')}
                      arrow
                      placement="top"
                      slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line', fontSize: '0.6875rem', lineHeight: 1.5 } } }}
                    >
                      <Box
                        sx={{
                          flex: 1,
                          height: 32,
                          borderRadius: 1,
                          bgcolor: colors.bg,
                          border: `1px solid ${colors.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 0.5,
                          cursor: 'default',
                          minWidth: 0,
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: '0.5625rem',
                            fontWeight: 600,
                            color: colors.text,
                            textTransform: 'uppercase',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {win.atOrderCap ? 'FULL' : healthLabel(win.health)}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
            </Box>
          )
        })}
        {hideCovered && visibleStores.length === 0 && (
          <Typography variant="body2" sx={{ color: t.text.tertiary, py: 1 }}>
            All windows covered.
          </Typography>
        )}
      </Box>

      {/* Footer */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {(['covered', 'at_risk', 'gap'] as const).map((health) => {
            const colors = healthColor(health)
            return (
              <Box key={health} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: colors.bg, border: `1px solid ${colors.border}` }} />
                <Typography sx={{ fontSize: '0.625rem', color: t.text.tertiary }}>{healthLabel(health)}</Typography>
              </Box>
            )
          })}
        </Box>
        {hasIssues && (
          <Box
            onClick={() => setHideCovered(!hideCovered)}
            sx={{
              fontSize: '0.6875rem',
              color: t.accent.primary,
              cursor: 'pointer',
              fontWeight: 500,
              userSelect: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {hideCovered ? 'Show all windows' : 'Hide covered'}
          </Box>
        )}
      </Box>
    </Box>
  )
}
