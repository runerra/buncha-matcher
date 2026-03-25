import { Select, MenuItem } from '@mui/material'
import { useAppTheme } from '../theme/ThemeContext'
import { REGIONS } from '../utils/regions'

interface RegionSelectorProps {
  selected: string
  onSelect: (id: string) => void
}

export function RegionSelector({ selected, onSelect }: RegionSelectorProps) {
  const { tokens: t } = useAppTheme()

  return (
    <Select
      value={selected}
      onChange={(e) => onSelect(e.target.value)}
      size="small"
      sx={{
        fontSize: '0.8125rem',
        fontWeight: 600,
        bgcolor: t.bg.secondary,
        borderRadius: 20,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: t.border.default,
          borderRadius: 20,
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: t.border.strong,
        },
        '& .MuiSelect-select': {
          py: 0.5,
          px: 1.5,
        },
      }}
    >
      {REGIONS.map((r) => (
        <MenuItem key={r.id} value={r.id} sx={{ fontSize: '0.8125rem' }}>
          {r.label}
        </MenuItem>
      ))}
    </Select>
  )
}
