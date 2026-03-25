import { useState } from 'react'
import { Box, Typography, Button, Collapse } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useAppTheme } from '../theme/ThemeContext'
import type { ActionCard as ActionCardData, IssueType } from '../data/mock'

function accentColor(priorityLabel: string | undefined, tokens: ReturnType<typeof useAppTheme>['tokens']) {
  switch (priorityLabel) {
    case 'Critical': return tokens.urgency.sameDay
    case 'High': return '#E67E22'
    case 'Medium': return tokens.urgency.t48
    default: return tokens.urgency.future
  }
}

interface ActionCardProps {
  card: ActionCardData
  onAccept: (cardId: string, workerName?: string) => void
  onDecline: (cardId: string) => void
}

export function ActionCard({ card, onAccept, onDecline }: ActionCardProps) {
  const { tokens: t } = useAppTheme()
  const [showDebug, setShowDebug] = useState(false)
  const [selectedWorker, setSelectedWorker] = useState<number>(0) // index into allCandidates
  const d = card.debug

  const activeCandidateName = d?.allCandidates?.[selectedWorker]?.workerName

  // Build accept label based on selected worker
  const acceptLabel = activeCandidateName && selectedWorker > 0
    ? card.acceptLabel.replace(/— \w+ .+$/, `— ${card.recommendation.toLowerCase()} ${activeCandidateName}`)
    : card.acceptLabel

  return (
    <Box
      sx={{
        display: 'flex',
        borderRadius: 1.5,
        bgcolor: t.bg.card,
        border: `1px solid ${t.border.default}`,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ width: 4, bgcolor: accentColor(card.priorityLabel, t), flexShrink: 0 }} />

      <Box sx={{ flex: 1, px: 2.5, py: 2 }}>
        <Typography
          sx={{ fontSize: '1rem', fontWeight: 700, color: t.text.primary, lineHeight: 1.3, mb: 0.5 }}
        >
          {card.storeName} · {card.windowTime}
        </Typography>

        <Typography
          sx={{ fontSize: '0.8125rem', color: t.text.secondary, lineHeight: 1.5, mb: 1.5 }}
        >
          {card.description}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => onAccept(card.id, activeCandidateName)}
              sx={{
                borderColor: t.accent.primary, color: t.accent.primary, fontWeight: 500,
                '&:hover': { borderColor: t.accent.primaryHover, bgcolor: `${t.accent.primary}08` },
              }}
            >
              {acceptLabel}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => onDecline(card.id)}
              sx={{
                borderColor: t.accent.decline, color: t.accent.decline, fontWeight: 500,
                '&:hover': { borderColor: t.accent.declineHover, bgcolor: `${t.accent.decline}08` },
              }}
            >
              Decline
            </Button>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography
              sx={{
                fontSize: '0.6875rem', color: t.text.tertiary, fontWeight: 500,
                letterSpacing: '0.03em', textTransform: 'uppercase',
              }}
            >
              {card.issueType} · {card.recommendation}
            </Typography>
            {d && (
              <Box
                onClick={() => setShowDebug(!showDebug)}
                sx={{
                  display: 'flex', alignItems: 'center', cursor: 'pointer',
                  color: t.text.tertiary, '&:hover': { color: t.text.secondary },
                }}
              >
                <ExpandMoreIcon sx={{
                  fontSize: 16,
                  transform: showDebug ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }} />
              </Box>
            )}
          </Box>
        </Box>

        {/* Debug + alternative selection panel */}
        {d && (
          <Collapse in={showDebug}>
            <Box
              sx={{
                mt: 1.5, pt: 1.5, borderTop: `1px solid ${t.border.subtle}`,
                fontSize: '0.75rem', color: t.text.secondary, lineHeight: 1.6,
              }}
            >
              <Row label="Threshold state" value={d.thresholdState} />
              <Row label="Shopper demand / supply" value={`${d.shopperDemand} / ${d.shopperSupply} units`} />
              {d.shopperGap > 0 && <Row label="Shopper gap" value={`${d.shopperGap} units short`} warn />}
              <Row label="Driver supply / target" value={`${d.driverSupply} / ${d.driverTarget}`} />
              {d.driverGap > 0 && <Row label="Driver gap" value={`${d.driverGap} short`} warn />}

              <Box sx={{ mt: 1, mb: 0.5, fontWeight: 600, color: t.text.primary, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Matching funnel
              </Box>
              <Row label="Workers in cluster" value={String(d.totalWorkersInCluster)} />
              <Row label="Passed availability filter" value={String(d.workersPassedFilter)} />
              <Row label="Had schedule conflicts" value={String(d.workersWithConflict)} />
              <Row label="Ranked candidates" value={String(d.allCandidates.length)} />
              {d.fallback && <Row label="Fallback" value={d.fallback} warn />}

              {d.filterReasons.length > 0 && (
                <Box sx={{ mt: 0.5 }}>
                  {d.filterReasons.map((r, i) => (
                    <Typography key={i} sx={{ fontSize: '0.6875rem', color: t.accent.decline }}>{r}</Typography>
                  ))}
                </Box>
              )}

              {/* Candidate list — clickable to select alternative */}
              {d.allCandidates.length > 0 && (
                <>
                  <Box sx={{ mt: 1, mb: 0.5, fontWeight: 600, color: t.text.primary, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {d.allCandidates.length > 1 ? 'Select worker' : 'Recommended worker'}
                  </Box>
                  {d.allCandidates.map((c, i) => {
                    const isSelected = i === selectedWorker
                    return (
                      <Box
                        key={i}
                        onClick={() => setSelectedWorker(i)}
                        sx={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          py: 0.75, px: 1.25, mb: 0.5, borderRadius: 1,
                          cursor: d.allCandidates.length > 1 ? 'pointer' : 'default',
                          bgcolor: isSelected ? `${t.accent.primary}0A` : 'transparent',
                          border: isSelected ? `1.5px solid ${t.accent.primary}` : `1px solid ${t.border.subtle}`,
                          '&:hover': d.allCandidates.length > 1 ? {
                            bgcolor: isSelected ? `${t.accent.primary}0A` : t.bg.secondary,
                            borderColor: isSelected ? t.accent.primary : t.border.default,
                          } : {},
                          transition: 'all 0.15s',
                        }}
                      >
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            {/* Radio indicator */}
                            <Box sx={{
                              width: 14, height: 14, borderRadius: '50%',
                              border: `2px solid ${isSelected ? t.accent.primary : t.border.strong}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              {isSelected && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: t.accent.primary }} />}
                            </Box>
                            <Typography sx={{ fontSize: '0.8125rem', fontWeight: isSelected ? 600 : 400, color: t.text.primary }}>
                              {c.workerName}
                            </Typography>
                            {i === 0 && (
                              <Typography sx={{ fontSize: '0.625rem', color: t.accent.primary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Best match
                              </Typography>
                            )}
                          </Box>
                          <Typography sx={{ fontSize: '0.6875rem', color: t.text.tertiary, pl: 2.75 }}>
                            {c.workerType} · {c.workerRole} · {c.reason}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.6875rem', color: t.text.tertiary, flexShrink: 0, ml: 1 }}>
                          +{c.capacityAdded} units
                        </Typography>
                      </Box>
                    )
                  })}
                </>
              )}

              {d.allCandidates.length === 0 && (
                <Typography sx={{ fontSize: '0.6875rem', color: t.accent.decline, mt: 0.5 }}>
                  No matching workers found. {d.fallback === 'ESCALATE' ? 'Escalation required.' : 'Consolidation suggested.'}
                </Typography>
              )}

              {/* Excluded workers — why not */}
              {d.excluded && d.excluded.length > 0 && (
                <ExcludedSection excluded={d.excluded} />
              )}
            </Box>
          </Collapse>
        )}
      </Box>
    </Box>
  )
}

function ExcludedSection({ excluded }: { excluded: { workerName: string; workerType: string; workerRole: string; reason: string }[] }) {
  const { tokens: t } = useAppTheme()
  const [showExcluded, setShowExcluded] = useState(false)

  // Group by reason
  const grouped = new Map<string, string[]>()
  for (const w of excluded) {
    const existing = grouped.get(w.reason) || []
    existing.push(w.workerName)
    grouped.set(w.reason, existing)
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Box
        onClick={() => setShowExcluded(!showExcluded)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
          '&:hover': { opacity: 0.8 },
        }}
      >
        <ExpandMoreIcon sx={{
          fontSize: 14, color: t.text.tertiary,
          transform: showExcluded ? 'rotate(180deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s',
        }} />
        <Typography sx={{ fontSize: '0.6875rem', color: t.text.tertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Excluded workers ({excluded.length})
        </Typography>
      </Box>
      <Collapse in={showExcluded}>
        <Box sx={{ mt: 0.75, pl: 0.5 }}>
          {[...grouped.entries()].map(([reason, names]) => (
            <Box key={reason} sx={{ mb: 0.75 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: t.accent.decline, fontWeight: 500, mb: 0.25 }}>
                {reason} ({names.length})
              </Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: t.text.tertiary, pl: 1 }}>
                {names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} + ${names.length - 5} more`}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const { tokens: t } = useAppTheme()
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.125 }}>
      <Typography sx={{ fontSize: '0.75rem', color: t.text.tertiary }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: warn ? t.accent.decline : t.text.primary }}>{value}</Typography>
    </Box>
  )
}
