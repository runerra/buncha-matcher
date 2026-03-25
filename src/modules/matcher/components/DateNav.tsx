import { Box, Typography } from '@mui/material'
import { useAppTheme } from '../theme/ThemeContext'

interface DateNavProps {
  selectedDate: Date
  onSelect: (date: Date) => void
  availableDates?: string[] // ISO dates from upload data, e.g. ["2026-03-23", "2026-03-24"]
}

export function DateNav({ selectedDate, onSelect, availableDates }: DateNavProps) {
  const { tokens: t } = useAppTheme()

  const days = availableDates && availableDates.length > 0
    ? buildFromISO(availableDates)
    : buildDayRange(4)

  const selectedKey = dateKey(selectedDate)

  return (
    <Box sx={{ display: 'flex', gap: 0.375 }}>
      {days.map((d) => {
        const key = dateKey(d.date)
        const isSelected = key === selectedKey

        return (
          <Box
            key={key}
            onClick={() => onSelect(d.date)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1.25,
              py: 0.5,
              borderRadius: 20,
              cursor: 'pointer',
              bgcolor: isSelected ? t.text.primary : 'transparent',
              border: `1px solid ${isSelected ? t.text.primary : t.border.default}`,
              '&:hover': {
                bgcolor: isSelected ? t.text.primary : t.bg.secondary,
              },
              transition: 'all 0.15s',
            }}
          >
            <Typography
              sx={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: isSelected ? t.text.inverse : t.text.primary,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {d.label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

function buildFromISO(dates: string[]) {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return dates.map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
    const monthName = date.toLocaleDateString('en-US', { month: 'short' })
    const isToday = iso === todayKey
    return {
      date,
      label: isToday ? 'Today' : `${dayName} ${monthName} ${d}`,
    }
  })
}

function buildDayRange(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
    const dateNum = d.getDate()
    return {
      date: d,
      label: i === 0 ? 'Today' : `${dayName} ${dateNum}`,
    }
  })
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
