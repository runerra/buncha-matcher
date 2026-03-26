import { useState } from 'react'
import { Box, Typography, Button, TextField, Popover, RadioGroup, FormControlLabel, Radio } from '@mui/material'
import { useAppTheme } from '../theme/ThemeContext'

const DECLINE_REASONS = [
  'Worker unavailable',
  'Schedule conflict',
  'Store not on worker\'s roster',
  'Other',
] as const

interface DeclineFormProps {
  anchorEl: HTMLElement | null
  workerName?: string
  onSubmit: (initials: string, reason: string) => void
  onCancel: () => void
}

export function DeclineForm({ anchorEl, workerName, onSubmit, onCancel }: DeclineFormProps) {
  const { tokens: t } = useAppTheme()
  const [initials, setInitials] = useState('')
  const [reason, setReason] = useState('')
  const [otherText, setOtherText] = useState('')

  const isOther = reason === 'Other'
  const effectiveReason = isOther ? otherText : reason
  const canSubmit = initials.length >= 2 && initials.length <= 4 && reason !== '' && (!isOther || otherText.trim() !== '')

  const handleSubmit = () => {
    if (canSubmit) onSubmit(initials.toUpperCase(), effectiveReason)
  }

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onCancel}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: t.bg.card,
            border: `1px solid ${t.border.default}`,
            borderRadius: 2,
            p: 2.5,
            width: 320,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          },
        },
      }}
    >
      <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: t.text.primary, mb: 0.5 }}>
        Decline recommendation
      </Typography>
      {workerName && (
        <Typography sx={{ fontSize: '0.75rem', color: t.text.tertiary, mb: 2 }}>
          {workerName}
        </Typography>
      )}

      <TextField
        label="Initials"
        size="small"
        value={initials}
        onChange={(e) => setInitials(e.target.value.slice(0, 4))}
        placeholder="e.g. JC"
        fullWidth
        inputProps={{ style: { textTransform: 'uppercase' } }}
        sx={{
          mb: 2,
          '& .MuiOutlinedInput-root': {
            fontSize: '0.8125rem',
            '& fieldset': { borderColor: t.border.default },
            '&:hover fieldset': { borderColor: t.border.strong },
            '&.Mui-focused fieldset': { borderColor: t.accent.primary },
          },
          '& .MuiInputLabel-root': { fontSize: '0.8125rem', color: t.text.tertiary },
        }}
      />

      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: t.text.secondary, mb: 1, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Reason
      </Typography>
      <RadioGroup value={reason} onChange={(e) => setReason(e.target.value)}>
        {DECLINE_REASONS.map((r) => (
          <FormControlLabel
            key={r}
            value={r}
            control={
              <Radio
                size="small"
                sx={{
                  color: t.border.strong,
                  '&.Mui-checked': { color: t.accent.primary },
                  p: 0.5,
                }}
              />
            }
            label={r}
            sx={{
              mx: 0, mb: 0.25,
              '& .MuiFormControlLabel-label': { fontSize: '0.8125rem', color: t.text.primary },
            }}
          />
        ))}
      </RadioGroup>

      {isOther && (
        <TextField
          size="small"
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
          placeholder="Describe reason..."
          fullWidth
          multiline
          minRows={2}
          sx={{
            mt: 1,
            '& .MuiOutlinedInput-root': {
              fontSize: '0.8125rem',
              '& fieldset': { borderColor: t.border.default },
              '&:hover fieldset': { borderColor: t.border.strong },
              '&.Mui-focused fieldset': { borderColor: t.accent.primary },
            },
          }}
        />
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 2, justifyContent: 'flex-end' }}>
        <Button
          size="small"
          onClick={onCancel}
          sx={{ color: t.text.tertiary, fontSize: '0.8125rem', fontWeight: 500 }}
        >
          Cancel
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={!canSubmit}
          onClick={handleSubmit}
          sx={{
            borderColor: t.accent.decline, color: t.accent.decline, fontWeight: 500, fontSize: '0.8125rem',
            '&:hover': { borderColor: t.accent.declineHover, bgcolor: `${t.accent.decline}08` },
            '&.Mui-disabled': { borderColor: t.border.subtle, color: t.text.tertiary },
          }}
        >
          Decline
        </Button>
      </Box>
    </Popover>
  )
}
