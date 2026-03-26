import { useState, useMemo, useCallback, useEffect } from 'react'
import { Box, Typography, Divider } from '@mui/material'
import { AppShell } from '../components/AppShell'
import { SummaryCounters } from '../components/SummaryCounters'
import { DateNav } from '../components/DateNav'
import { RegionSelector } from '../components/RegionSelector'
import { StoreHealthGrid } from '../components/StoreHealthGrid'
import { ScheduleUpload, type UploadResult } from '../components/ScheduleUpload'
import { ActionCard } from '../components/ActionCard'
import { useAppTheme } from '../theme/ThemeContext'
import { filterStoresByRegion } from '../utils/regions'
import type { ActionCard as ActionCardType, StoreWindowHealth } from '../data/mock'

function SectionLabel({ children, count }: { children: string; count?: number }) {
  const { tokens: t } = useAppTheme()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Typography
        sx={{
          fontSize: '0.6875rem',
          color: t.text.tertiary,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Typography>
      {count != null && count > 0 && (
        <Box
          sx={{
            bgcolor: t.bg.tertiary,
            color: t.text.secondary,
            fontSize: '0.625rem',
            fontWeight: 700,
            px: 0.75,
            py: 0.125,
            borderRadius: 0.75,
            lineHeight: 1.4,
          }}
        >
          {count}
        </Box>
      )}
    </Box>
  )
}

function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Dashboard() {
  const { tokens: t } = useAppTheme()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [selectedRegion, setSelectedRegion] = useState('detroit')
  const [uploadData, setUploadData] = useState<UploadResult | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const saved = localStorage.getItem('matcher-upload')
      if (!saved) return null
      const data = JSON.parse(saved)
      data.parsed.orderVolumes = new Map(data.parsed._orderVolumes || [])
      data.parsed.windowOrderData = new Map(data.parsed._windowOrderData || [])
      return data as UploadResult
    } catch { return null }
  })

  // Track accepted assignments: workerName → list of window times they're now assigned to
  interface AcceptedAssignment { workerName: string; storeName: string; windowTime: string; windowId: string }
  const [acceptedAssignments, setAcceptedAssignments] = useState<AcceptedAssignment[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('matcher-assignments') || '[]') } catch { return [] }
  })

  // Track accepted/declined cards and their effects
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('matcher-dismissed')
      return new Set(saved ? JSON.parse(saved) : [])
    } catch { return new Set() }
  })
  const [reopenedWindows, setReopenedWindows] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = localStorage.getItem('matcher-reopened')
      return new Set(saved ? JSON.parse(saved) : [])
    } catch { return new Set() }
  })

  // Audit log + Twilio messages
  interface AuditEntry {
    timestamp: string
    action: 'ACCEPTED' | 'DECLINED'
    cardLabel: string
    worker?: string
    impact?: {
      capacityAdded: number
      demandBefore: number
      supplyBefore: number
      supplyAfter: number
      windowReopened: boolean
      ordersSaved: number
      recommendation: string
    }
  }
  interface TwilioMsg { id: string; to: string; context: string; body: string; status: 'pending' | 'sent' }

  const [auditLog, setAuditLog] = useState<AuditEntry[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('matcher-audit') || '[]') } catch { return [] }
  })
  const [twilioMessages, setTwilioMessages] = useState<TwilioMsg[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('matcher-twilio') || '[]') } catch { return [] }
  })

  const selectedISO = dateToISO(selectedDate)
  const dayResult = uploadData?.byDate?.[selectedISO] ?? null

  // Window health: filtered by region, with reopened windows marked as covered
  const activeHealth: StoreWindowHealth[] = useMemo(() => {
    const raw = dayResult?.windowHealth ?? []
    const regionFiltered = filterStoresByRegion(raw, selectedRegion)
    // Apply reopened windows — mark them as covered
    return regionFiltered.map((store) => ({
      ...store,
      windows: store.windows.map((w) =>
        reopenedWindows.has(w.id) ? { ...w, health: 'covered' as const, isOpen: true } : w,
      ),
    }))
  }, [dayResult, selectedRegion, reopenedWindows])

  // Action cards: filter by region and remove dismissed
  const filteredQueue: ActionCardType[] = useMemo(() => {
    if (!dayResult || !uploadData) return []
    const regionStores = filterStoresByRegion(
      uploadData.parsed.stores.map((s) => ({ ...s, storeName: s.name })),
      selectedRegion,
    )
    const storeNames = new Set(regionStores.map((s) => s.name))

    // Build cards for every GAP window. Each window may need both shopper and driver cards.
    // Use engine recommendations where available, otherwise ESCALATE.
    const fmtH = (h: number) => h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`
    const recsByWindowId = new Map<string, any>()
    for (const r of dayResult.recommendations) {
      recsByWindowId.set(r.windowId, r)
    }

    const allRecs: any[] = []
    for (const store of activeHealth) {
      for (const win of store.windows) {
        if (win.health !== 'gap') continue
        if (reopenedWindows.has(win.id)) continue

        const fullWin = uploadData.parsed.windows.find((w) => w.id === win.id)
        const od = uploadData.parsed.windowOrderData.get(win.id)
        const startH = fullWin ? parseInt(fullWin.startTime.split(':')[0]) : 0
        const endH = fullWin ? parseInt(fullWin.endTime.split(':')[0]) : 0
        const windowTime = `${fmtH(startH)}–${fmtH(endH)}`

        // Check for shopper need (demand > supply OR no meaningful shopper coverage)
        const hasShopperGap = win.units > win.maxCapacity || win.maxCapacity < 22
        const shopperRecId = win.id + '-shopper'
        const shopperRec = recsByWindowId.get(shopperRecId)
        if (hasShopperGap) {
          if (shopperRec) {
            allRecs.push(shopperRec)
          } else {
            allRecs.push({
              windowId: shopperRecId,
              storeName: store.storeName,
              windowTime,
              issueType: 'Understaffed',
              recommendation: 'ESCALATE',
              description: od ? `${od.units}/${od.maxCapacity} units · needs shopper coverage` : 'Needs shopper coverage',
              acceptLabel: 'Accept — escalate',
            })
          }
        }

        // Check for driver need
        if (!win.driverOk) {
          const driverRecId = win.id + '-driver'
          const driverRec = recsByWindowId.get(driverRecId)
          if (driverRec) {
            allRecs.push(driverRec)
          } else {
            allRecs.push({
              windowId: driverRecId,
              storeName: store.storeName,
              windowTime,
              issueType: 'Driver missing',
              recommendation: 'ESCALATE',
              description: '1 driver short · no workers available',
              acceptLabel: 'Accept — escalate',
            })
          }
        }

        // If neither specific gap but still flagged (e.g. by engine), use generic
        if (!hasShopperGap && win.driverOk) {
          const genericRec = recsByWindowId.get(win.id + '-shopper') || recsByWindowId.get(win.id + '-driver')
          if (genericRec) {
            allRecs.push(genericRec)
          }
        }
      }
    }

    return allRecs
      .map((r, i) => ({
        id: `${selectedISO}-${r.storeName}-${r.windowTime}-${i}`,
        issueType: r.issueType as ActionCardType['issueType'],
        recommendation: r.recommendation as ActionCardType['recommendation'],
        storeName: r.storeName,
        windowTime: r.windowTime,
        description: r.description,
        acceptLabel: r.acceptLabel,
        status: 'needs_action' as const,
        dayOffset: 0,
        windowId: r.windowId,
        units: ('units' in r ? r.units : 0) as number,
        priorityScore: ('priority' in r && r.priority ? (r as any).priority.score : 70) as number,
        priorityLabel: ('priority' in r && r.priority ? (r as any).priority.label : 'High') as ActionCardType['priorityLabel'],
        debug: ('debug' in r ? r.debug : undefined) as ActionCardType['debug'],
      }))
      .filter((c) => !dismissedCards.has(c.id))
      .map((card) => {
        // Post-process: remove workers who have been assigned to other windows
        if (!card.debug?.allCandidates || acceptedAssignments.length === 0) return card

        // Check which assigned workers now have a time conflict with this card's window
        const assignedWorkerNames = new Set<string>()
        for (const assignment of acceptedAssignments) {
          // Same worker, check if the assigned window overlaps with this card's window
          // Simple heuristic: if assigned to a different window on the same day, mark as potentially conflicting
          // More precise: check actual time overlap
          if (assignment.windowId === card.windowId) continue // same window, skip
          assignedWorkerNames.add(assignment.workerName)
        }

        if (assignedWorkerNames.size === 0) return card

        // Filter candidates — keep workers not assigned elsewhere, or still available
        const updatedCandidates = card.debug.allCandidates.filter(
          (c) => !assignedWorkerNames.has(c.workerName)
        )

        // Update the accept label to reflect the new top candidate
        const newTop = updatedCandidates[0]
        const updatedLabel = newTop
          ? card.acceptLabel.replace(/— \w+ .+$/, `— ${card.recommendation.toLowerCase()} ${newTop.workerName}`)
          : 'Accept — escalate'

        return {
          ...card,
          acceptLabel: updatedCandidates.length > 0 ? updatedLabel : 'Accept — escalate',
          recommendation: updatedCandidates.length > 0 ? card.recommendation : 'ESCALATE' as ActionCardType['recommendation'],
          debug: {
            ...card.debug,
            allCandidates: updatedCandidates.map((c, idx) => ({ ...c, isTopPick: idx === 0 })),
          },
        }
      })
      .sort((a, b) => {
        const aScore = a.priorityScore ?? 0
        const bScore = b.priorityScore ?? 0
        if (aScore !== bScore) return bScore - aScore
        return (b.units ?? 0) - (a.units ?? 0)
      })
  }, [dayResult, selectedRegion, selectedISO, uploadData, dismissedCards, acceptedAssignments, activeHealth, reopenedWindows])

  // Count orders saved (sum of units in reopened windows)
  const ordersSaved = useMemo(() => {
    if (!uploadData) return 0
    let total = 0
    for (const winId of reopenedWindows) {
      const od = uploadData.parsed.windowOrderData.get(winId)
      if (od) total += od.orders
    }
    return total
  }, [reopenedWindows, uploadData])

  const handleAccept = useCallback((cardId: string, workerName?: string) => {
    const card = filteredQueue.find((c) => c.id === cardId)

    // Record the assignment so other cards can check availability
    if (card && workerName && card.windowId) {
      setAcceptedAssignments((prev) => {
        const next = [...prev, { workerName, storeName: card.storeName, windowTime: card.windowTime, windowId: card.windowId! }]
        localStorage.setItem('matcher-assignments', JSON.stringify(next))
        return next
      })
    }

    setDismissedCards((prev) => {
      const next = new Set(prev)
      next.add(cardId)
      localStorage.setItem('matcher-dismissed', JSON.stringify([...next]))
      return next
    })
    if (card?.windowId) {
      // Strip -shopper / -driver suffix so the base window ID matches health grid entries
      const baseWindowId = card.windowId.replace(/-(shopper|driver)$/, '')
      setReopenedWindows((prev) => {
        const next = new Set(prev)
        next.add(baseWindowId)
        localStorage.setItem('matcher-reopened', JSON.stringify([...next]))
        return next
      })
    }
    // Audit log with impact data
    if (card) {
      // Get order data and debug info for impact calculation (use base window ID without -shopper/-driver suffix)
      const baseWinId = card.windowId?.replace(/-(shopper|driver)$/, '')
      const od = baseWinId ? uploadData?.parsed.windowOrderData.get(baseWinId) : undefined
      const d = card.debug
      const selectedCandidate = d?.allCandidates?.find((c) => workerName ? c.workerName === workerName : c.isTopPick)
      const capacityAdded = selectedCandidate?.capacityAdded ?? 0
      const supplyBefore = d?.shopperSupply ?? 0
      const demandBefore = d?.shopperDemand ?? 0
      const supplyAfter = supplyBefore + capacityAdded
      const windowReopened = supplyBefore < demandBefore && supplyAfter >= demandBefore

      const entry: AuditEntry = {
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        action: 'ACCEPTED',
        cardLabel: `${card.storeName} · ${card.windowTime}`,
        worker: workerName,
        impact: {
          capacityAdded,
          demandBefore,
          supplyBefore,
          supplyAfter,
          windowReopened,
          ordersSaved: windowReopened ? (od?.orders ?? 0) : 0,
          recommendation: card.recommendation,
        },
      }
      setAuditLog((prev) => {
        const next = [entry, ...prev]
        localStorage.setItem('matcher-audit', JSON.stringify(next))
        return next
      })

      // Generate Twilio message for worker-based recommendations
      if (workerName && card.recommendation !== 'ESCALATE' && card.recommendation !== 'CONSOLIDATE') {
        const msg: TwilioMsg = {
          id: `msg-${Date.now()}`,
          to: workerName,
          context: `${card.recommendation} · ${card.storeName} ${card.windowTime}`,
          body: `Hi ${workerName.split(' ')[0]} — can you cover a shift at ${card.storeName} for the ${card.windowTime} delivery window? Reply YES to confirm or NO to decline.`,
          status: 'pending',
        }
        setTwilioMessages((prev) => {
          const next = [msg, ...prev]
          localStorage.setItem('matcher-twilio', JSON.stringify(next))
          return next
        })
      }
    }
  }, [filteredQueue])

  const handleDecline = useCallback((cardId: string) => {
    const card = filteredQueue.find((c) => c.id === cardId)
    setDismissedCards((prev) => {
      const next = new Set(prev)
      next.add(cardId)
      localStorage.setItem('matcher-dismissed', JSON.stringify([...next]))
      return next
    })
    if (card) {
      const entry: AuditEntry = {
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        action: 'DECLINED',
        cardLabel: `${card.storeName} · ${card.windowTime}`,
      }
      setAuditLog((prev) => {
        const next = [entry, ...prev]
        localStorage.setItem('matcher-audit', JSON.stringify(next))
        return next
      })
    }
  }, [filteredQueue])

  // Auto-select first available date when upload data loads
  useEffect(() => {
    if (uploadData?.dates?.length) {
      const [y, m, d] = uploadData.dates[0].split('-').map(Number)
      setSelectedDate(new Date(y, m - 1, d))
    }
  }, [uploadData?.dates?.length]) // eslint-disable-line

  const handleUpload = useCallback((result: UploadResult) => {
    setUploadData(result)
    // Clear dismissed/reopened state on new upload
    setDismissedCards(new Set())
    setReopenedWindows(new Set())
    localStorage.removeItem('matcher-dismissed')
    localStorage.removeItem('matcher-reopened')
    setAuditLog([])
    setTwilioMessages([])
    setAcceptedAssignments([])
    localStorage.removeItem('matcher-audit')
    localStorage.removeItem('matcher-twilio')
    localStorage.removeItem('matcher-assignments')
    try {
      const toSave = {
        ...result,
        parsed: {
          ...result.parsed,
          orderVolumes: undefined,
          _orderVolumes: Array.from(result.parsed.orderVolumes.entries()),
          windowOrderData: undefined,
          _windowOrderData: Array.from(result.parsed.windowOrderData.entries()),
        },
      }
      localStorage.setItem('matcher-upload', JSON.stringify(toSave))
    } catch { /* quota exceeded */ }
  }, [])

  return (
    <AppShell>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <RegionSelector selected={selectedRegion} onSelect={setSelectedRegion} />
          <DateNav
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            availableDates={uploadData?.dates}
          />
        </Box>

        <ScheduleUpload onResult={handleUpload} hasRestoredData={!!uploadData} />

        <SummaryCounters
          storeHealth={activeHealth}
          needsAction={filteredQueue.length}
          reopenedToday={reopenedWindows.size}
          ordersSaved={ordersSaved}
        />

        {activeHealth.length > 0 && (
          <Box>
            <SectionLabel>Window Health</SectionLabel>
            <StoreHealthGrid stores={activeHealth} />
          </Box>
        )}

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <SectionLabel count={filteredQueue.length}>Action Queue</SectionLabel>
            {dismissedCards.size > 0 && (
              <Typography
                onClick={() => {
                  setDismissedCards(new Set())
                  setReopenedWindows(new Set())
                  setAuditLog([])
                  setTwilioMessages([])
                  setAcceptedAssignments([])
                  localStorage.removeItem('matcher-dismissed')
                  localStorage.removeItem('matcher-reopened')
                  localStorage.removeItem('matcher-audit')
                  localStorage.removeItem('matcher-twilio')
                  localStorage.removeItem('matcher-assignments')
                }}
                sx={{
                  fontSize: '0.6875rem', color: t.accent.primary, cursor: 'pointer',
                  fontWeight: 500, '&:hover': { textDecoration: 'underline' },
                }}
              >
                Reset all actions
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {filteredQueue.map((card) => (
              <ActionCard
                key={card.id}
                card={card}
                onAccept={handleAccept}
                onDecline={handleDecline}
              />
            ))}
            {filteredQueue.length === 0 && (
              <Typography variant="body2" sx={{ color: t.text.tertiary, py: 1 }}>
                {!uploadData
                  ? 'Upload shift schedule and orders to get started.'
                  : dayResult && dayResult.gaps.length > 0 && dayResult.recommendations.length === 0
                    ? `${dayResult.gaps.length} gaps detected but no workers available — escalation needed.`
                    : dismissedCards.size > 0 && dayResult && dayResult.recommendations.length > 0
                      ? `All ${dayResult.recommendations.length} actions resolved or dismissed.`
                      : 'No actions needed for this day.'}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Resolved actions */}
        {auditLog.filter((e) => e.action === 'ACCEPTED').length > 0 && (
          <Box>
            <SectionLabel>Resolved</SectionLabel>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {auditLog
                .filter((e) => e.action === 'ACCEPTED')
                .map((e, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 2,
                      py: 1.25,
                      borderRadius: 1,
                      bgcolor: t.bg.secondary,
                      borderLeft: `3px solid #B8D4C8`,
                    }}
                  >
                    <Typography variant="body2" sx={{ color: t.text.secondary }}>
                      {e.cardLabel}{e.worker ? ` · ${e.worker}` : ''} · accepted {e.timestamp}
                    </Typography>
                    <Box sx={{ px: 1.25, py: 0.25, borderRadius: 0.75, bgcolor: '#E8F0EC', color: '#2D7A4F', fontSize: '0.75rem', fontWeight: 600, flexShrink: 0, ml: 2 }}>
                      Resolved
                    </Box>
                  </Box>
                ))}
            </Box>
          </Box>
        )}

        {/* Comms Center */}
        {twilioMessages.length > 0 && (
          <>
            <Divider sx={{ borderColor: t.border.default }} />
            <Box>
              <SectionLabel>Comms Center</SectionLabel>
              <Typography variant="body2" sx={{ color: t.text.secondary, mb: 2.5 }}>
                Pre-populated messages from approved recommendations. Review, edit, and send.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {twilioMessages.map((msg) => (
                  <Box key={msg.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: msg.status === 'sent' ? '#2D7A4F' : '#D4A843' }} />
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: t.text.primary }}>
                          To: {msg.to}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.75rem', color: t.text.tertiary, fontWeight: 500 }}>
                        {msg.status === 'sent' ? 'Sent' : 'Pending'}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.75rem', color: t.text.tertiary, display: 'block', mb: 1, pl: 2.25 }}>
                      {msg.context}
                    </Typography>
                    <Box sx={{ bgcolor: t.bg.secondary, border: `1px solid ${t.border.default}`, borderRadius: 1, px: 2, py: 1.5, ml: 2.25 }}>
                      <Typography variant="body2" sx={{ color: t.text.tertiary, lineHeight: 1.6 }}>
                        {msg.body}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </>
        )}

        {/* Audit Log */}
        {auditLog.length > 0 && (
          <>
            <Divider sx={{ borderColor: t.border.default }} />
            <Box>
              <SectionLabel>Activity Log</SectionLabel>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {auditLog.map((e, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
                    <Typography sx={{ fontSize: '0.75rem', color: t.text.secondary }}>
                      {e.cardLabel}{e.worker ? ` · ${e.worker}` : ''}
                      {e.impact?.capacityAdded ? ` · +${e.impact.capacityAdded} units` : ''}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, ml: 2 }}>
                      {e.impact?.windowReopened && (
                        <Typography sx={{ fontSize: '0.6875rem', color: '#2D7A4F', fontWeight: 600 }}>
                          Window reopened
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: '0.6875rem', color: t.text.tertiary }}>
                        {e.action === 'ACCEPTED' ? 'Accepted' : 'Declined'} {e.timestamp}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </AppShell>
  )
}
