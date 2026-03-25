import { useRef, useState, useCallback } from 'react'
import { Box, Typography, Button, Collapse } from '@mui/material'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useAppTheme } from '../theme/ThemeContext'
import { parseScheduleFile, parseWIWFiles, parseOrderCSV, applyOrderData, type ParsedSchedule } from '../utils/parseUpload'
import { evaluateCluster } from '../engines/cluster'
import { matchWorkers, filterWithReasons } from '../engines/matcher'
import { calculatePriority, sortByPriority, type PriorityResult } from '../engines/priority'
import { DEFAULT_THRESHOLDS } from '../types'
import type { StoreWindowHealth } from '../data/mock'
import type { ThresholdResult } from '../types'

export interface RecommendationDebug {
  workerName: string
  workerType: string
  workerRole: string
  priority: number
  reason: string
  capacityAdded: number
  isTopPick: boolean
}

export interface RecommendationDetail {
  windowId: string
  storeName: string
  windowTime: string
  issueType: string
  recommendation: string
  description: string
  acceptLabel: string
  priority: PriorityResult
  units: number
  debug: {
    shopperSupply: number
    shopperDemand: number
    shopperGap: number
    driverSupply: number
    driverTarget: number
    driverGap: number
    thresholdState: string
    totalWorkersInCluster: number
    workersPassedFilter: number
    workersWithConflict: number
    allCandidates: RecommendationDebug[]
    excluded: { workerName: string; workerType: string; workerRole: string; reason: string }[]
    fallback: string | null
    filterReasons: string[]
  }
}

export interface DayResult {
  windowHealth: StoreWindowHealth[]
  gaps: ThresholdResult[]
  recommendations: RecommendationDetail[]
}

export interface UploadResult {
  parsed: ParsedSchedule
  byDate: Record<string, DayResult>  // "2026-03-24" → results for that day
  dates: string[]                     // sorted list of available dates
}

interface ScheduleUploadProps {
  onResult: (result: UploadResult) => void
  hasRestoredData?: boolean
}

interface FileEntry { name: string; buffer: ArrayBuffer }

export function ScheduleUpload({ onResult, hasRestoredData }: ScheduleUploadProps) {
  const { tokens: t } = useAppTheme()
  const scheduleRef = useRef<HTMLInputElement>(null)
  const rosterRef = useRef<HTMLInputElement>(null)
  const ordersRef = useRef<HTMLInputElement>(null)
  const [scheduleFile, setScheduleFile] = useState<FileEntry | null>(null)
  const [rosterFile, setRosterFile] = useState<FileEntry | null>(null)
  const [ordersFile, setOrdersFile] = useState<FileEntry | null>(null)
  const [status, setStatus] = useState<'idle' | 'loaded' | 'error'>(hasRestoredData ? 'loaded' : 'idle')
  const [summary, setSummary] = useState(hasRestoredData ? 'Restored from previous session' : '')
  const [errors, setErrors] = useState<string[]>([])
  const [showErrors, setShowErrors] = useState(false)

  const runAll = useCallback((
    schedule: FileEntry | null,
    roster: FileEntry | null,
    orders: FileEntry | null,
  ) => {
    if (!schedule) return

    try {
      let parsed: ParsedSchedule
      if (roster) {
        parsed = parseWIWFiles(schedule.buffer, roster.buffer)
      } else {
        parsed = parseScheduleFile(schedule.buffer)
      }

      // Apply order data if provided
      if (orders) {
        const text = new TextDecoder().decode(orders.buffer)
        const orderRows = parseOrderCSV(text)
        applyOrderData(parsed, orderRows)
      }

      processResult(parsed)
    } catch (err: any) {
      setStatus('error')
      setErrors([`${err?.message || err}`, err?.stack || ''])
    }
  }, []) // eslint-disable-line -- onResult is stable

  function processResult(parsed: ParsedSchedule) {
    if (parsed.stores.length === 0 && parsed.shifts.length === 0) {
      setStatus('error')
      setErrors(['No data found. Check file format.'])
      return
    }

    // Get all unique dates from windows AND shifts
    const allDates = new Set([
      ...parsed.windows.map((w) => w.date),
      ...parsed.shifts.map((s) => s.date),
    ])
    const dates = [...allDates].sort()
    const now = new Date()
    const byDate: Record<string, DayResult> = {}
    let totalGaps = 0

    for (const date of dates) {
      const dayWindows = parsed.windows.filter((w) => w.date === date)
      const dayShifts = parsed.shifts.filter((s) => s.date === date)

      // Build order volumes for just this day's windows
      const dayVolumes = new Map<string, number>()
      for (const win of dayWindows) {
        dayVolumes.set(win.id, parsed.orderVolumes.get(win.id) ?? 0)
      }

      const clusterResult = evaluateCluster({
        clusterId: 'all',
        windows: dayWindows,
        shifts: dayShifts,
        workers: parsed.workers,
        stores: parsed.stores,
        orderVolumes: dayVolumes,
        now,
        thresholds: DEFAULT_THRESHOLDS,
      })

      // Build window health for this day
      const storeHealthMap = new Map<string, StoreWindowHealth>()
      for (const store of parsed.stores) {
        storeHealthMap.set(store.id, { storeId: store.id, storeName: store.name, windows: [] })
      }

      for (const wr of clusterResult.windowResults) {
        const win = dayWindows.find((w) => w.id === wr.windowId)
        if (!win) continue
        const entry = storeHealthMap.get(win.storeId)
        if (!entry) continue

        const fmt = (h: number) => h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`
        const startH = parseInt(win.startTime.split(':')[0])
        const endH = parseInt(win.endTime.split(':')[0])

        // Get order file data for this window — source of truth for capacity
        const od = parsed.windowOrderData.get(win.id)
        const maxCap = od?.maxCapacity ?? 0
        const units = od?.units ?? 0
        const orders = od?.orders ?? 0
        const maxOrderCap = od?.maxOrderCapacity ?? 8

        // Window open = has remaining unit capacity to accept more orders
        const isOpen = maxCap - units >= 22

        // GAP = demand exceeds supply (existing orders can't be fulfilled)
        const hasStaffingGap = maxCap > 0 && units > maxCap
        const hasDriverGap = wr.driverGap > 0

        // Health status:
        // GAP: demand > supply OR driver missing — orders at risk of not being fulfilled
        // AT RISK: supply covers demand but window can't accept more orders (< 22 units headroom)
        // COVERED: supply covers demand with room to spare
        const health = hasStaffingGap || hasDriverGap ? 'gap'
          : !isOpen && units > 0 ? 'at_risk'
          : 'covered'

        entry.windows.push({
          id: win.id,
          time: `${fmt(startH)}–${fmt(endH)}`,
          health: health as 'covered' | 'at_risk' | 'gap',
          maxCapacity: maxCap,
          units,
          orders,
          maxOrderCapacity: maxOrderCap,
          isOpen,
          atOrderCap: orders >= maxOrderCap,
          driverOk: !hasDriverGap,
        })
      }

      const windowHealth = Array.from(storeHealthMap.values())
        .filter((s) => s.windows.length > 0)
      for (const s of windowHealth) {
        s.windows.sort((a, b) => {
          const aH = parseInt(a.time)
          const bH = parseInt(b.time)
          return aH - bH
        })
      }

      // Generate recommendations for ALL gap windows (from order file, source of truth)
      // A window may need BOTH a driver AND shoppers — generate separate cards for each need
      interface GapNeed {
        winId: string; storeId: string; needType: 'shopper' | 'driver'
        units: number; maxCap: number
        driverSupply: number; driverTarget: number
      }
      const gapNeeds: GapNeed[] = []
      for (const store of windowHealth) {
        for (const w of store.windows) {
          if (w.health !== 'gap') continue
          const fullWin = dayWindows.find((dw) => dw.id === w.id)
          if (!fullWin) continue
          const engineResult = clusterResult.windowResults.find((r) => r.windowId === w.id)
          const driverTarget = parsed.stores.find((s) => s.id === fullWin.storeId)?.driverTarget ?? 1
          const driverSupply = engineResult?.driverSupply ?? 0

          // Shopper gap: demand exceeds supply OR no meaningful shopper coverage (maxCap < 22)
          const hasShopperNeed = w.units > w.maxCapacity || w.maxCapacity < 22
          if (hasShopperNeed) {
            gapNeeds.push({ winId: w.id, storeId: fullWin.storeId, needType: 'shopper', units: w.units, maxCap: w.maxCapacity, driverSupply, driverTarget })
          }

          // Driver gap
          if (!w.driverOk) {
            gapNeeds.push({ winId: w.id, storeId: fullWin.storeId, needType: 'driver', units: w.units, maxCap: w.maxCapacity, driverSupply, driverTarget })
          }
        }
      }
      totalGaps += gapNeeds.length

      const recommendations: RecommendationDetail[] = gapNeeds.map((need) => {
        const win = dayWindows.find((w) => w.id === need.winId)!
        const store = parsed.stores.find((s) => s.id === need.storeId)!
        const needsShoppers = need.needType === 'shopper'
        const needsDrivers = need.needType === 'driver'
        const gap = {
          windowId: need.winId,
          storeId: need.storeId,
          shopperSupply: need.maxCap,
          shopperDemand: need.units,
          shopperGap: needsShoppers ? Math.max(0, need.units - need.maxCap) : 0,
          shopperUtilPct: need.maxCap > 0 ? need.units / need.maxCap : Infinity,
          driverSupply: need.driverSupply,
          driverTarget: need.driverTarget,
          driverGap: needsDrivers ? Math.max(0, need.driverTarget - need.driverSupply) : 0,
          thresholdState: 'GAP' as const,
          urgency: 'CRITICAL' as const,
          gapType: (needsDrivers ? 'DRIVER_GAP' : 'SHOPPER_GAP') as any,
          shouldCreateCard: true,
          shouldUpdateCard: true,
          shouldAutoResolve: false,
        }
        const { available, excluded } = filterWithReasons(
          parsed.workers, dayShifts, win, win.date, store.id, store.clusterId, needsShoppers, needsDrivers,
        )
        const withConflict = available.filter((a) => a.hasConflictingShift).length
        const match = matchWorkers(gap, available, win)

        const topRec = match.recommendations[0]
        const issueType = gap.driverGap > 0 ? 'Driver missing' : 'Understaffed'
        const recType = topRec
          ? (topRec.priority === 1 ? 'ASSIGN'      // Floater → assign to store
            : topRec.priority === 2 ? 'ASSIGN'     // Shift Lead → already on-site
            : topRec.priority === 3 ? 'ACTIVATE'   // Flex → SMS outreach
            : topRec.priority === 4 ? 'ASSIGN'     // Fixed same store → already there
            : topRec.priority === 5 ? 'MOVE'       // Fixed neighboring store → move
            : 'ASSIGN')
          : match.fallback === 'CONSOLIDATE' ? 'CONSOLIDATE' : 'ESCALATE'

        const startH = parseInt(win.startTime.split(':')[0])
        const endH = parseInt(win.endTime.split(':')[0])
        const fmtH = (h: number) => h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`

        const priorityLabel = (p: number) =>
          p === 1 ? 'Floater' : p === 2 ? 'Shift Lead' : p === 3 ? 'Flex' : p === 4 ? 'Fixed (same store)' : p === 5 ? 'Fixed (neighboring)' : 'Other'

        const filterReasons: string[] = []
        const totalConsidered = available.length + excluded.length
        if (totalConsidered === 0) filterReasons.push('No workers found')
        if (available.length === 0 && excluded.length > 0) filterReasons.push('All workers filtered out')
        if (available.length > 0 && match.recommendations.length === 0) filterReasons.push('Available workers exist but none match gap type/store approval')

        // Get order data for priority scoring
        const od = parsed.windowOrderData.get(win.id)
        const winUnits = od?.units ?? gap.shopperDemand
        const winOrders = od?.orders ?? 0
        const winMaxOrderCap = od?.maxOrderCapacity ?? 8
        const winMaxCap = od?.maxCapacity ?? 0

        return {
          windowId: gap.windowId + (needsDrivers ? '-driver' : '-shopper'),
          storeName: store.name,
          windowTime: `${fmtH(startH)}–${fmtH(endH)}`,
          issueType,
          recommendation: recType,
          description: gap.driverGap > 0
            ? `${gap.driverGap} driver${gap.driverGap > 1 ? 's' : ''} short`
            : gap.shopperGap > 0
              ? `${gap.shopperGap} units short · ${gap.shopperDemand}/${gap.shopperSupply} units`
              : `${gap.shopperDemand}/${gap.shopperSupply} units`,
          acceptLabel: topRec
            ? `Accept — ${recType.toLowerCase()} ${topRec.workerName}`
            : recType === 'CONSOLIDATE' ? 'Accept — consolidate' : 'Accept — escalate',
          units: winUnits,
          // Placeholder — computed after all recs are built
          priority: { score: 0, timeScore: 0, severityScore: 0, revenueScore: 0, label: 'Low' as const },
          _priorityInput: {
            timeToWindow: 'same_day' as const, // TODO: compute from date vs now
            thresholdState: gap.thresholdState,
            units: winUnits,
            orders: winOrders,
            maxOrderCapacity: winMaxOrderCap,
            shopperSupply: gap.shopperSupply,
            shopperDemand: gap.shopperDemand,
          },
          debug: {
            shopperSupply: gap.shopperSupply,
            shopperDemand: gap.shopperDemand,
            shopperGap: gap.shopperGap,
            driverSupply: gap.driverSupply,
            driverTarget: gap.driverTarget,
            driverGap: gap.driverGap,
            thresholdState: gap.thresholdState,
            totalWorkersInCluster: available.length + excluded.length,
            workersPassedFilter: available.length,
            workersWithConflict: withConflict,
            allCandidates: match.recommendations.map((r, idx) => ({
              workerName: r.workerName,
              workerType: priorityLabel(r.priority),
              workerRole: r.role,
              priority: r.priority,
              reason: r.reason,
              capacityAdded: r.capacityAdded,
              isTopPick: idx === 0,
            })),
            excluded,
            fallback: match.fallback,
            filterReasons,
          },
        }
      })

      // Compute time-to-window for each recommendation
      const todayISO = new Date().toISOString().split('T')[0]
      const todayDate = new Date(todayISO)
      const windowDate = new Date(date)
      const daysDiff = Math.round((windowDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
      const timeToWindow: 'same_day' | 't_24hr' | 't_48hr' | 't_7d' =
        daysDiff <= 0 ? 'same_day' : daysDiff === 1 ? 't_24hr' : daysDiff <= 2 ? 't_48hr' : 't_7d'

      // Calculate priorities — need max units for normalization
      const maxUnits = Math.max(1, ...recommendations.map((r) => (r as any)._priorityInput?.units ?? 0))
      for (const rec of recommendations) {
        const input = (rec as any)._priorityInput
        if (input) {
          input.timeToWindow = timeToWindow
          rec.priority = calculatePriority(input, maxUnits)
        }
        delete (rec as any)._priorityInput
      }

      // Sort by priority score descending
      recommendations.sort((a, b) => {
        if (a.priority.score !== b.priority.score) return b.priority.score - a.priority.score
        if (a.units !== b.units) return b.units - a.units
        return a.windowTime.localeCompare(b.windowTime)
      })

      byDate[date] = { windowHealth, gaps: clusterResult.windowResults.filter((r) => r.thresholdState !== 'OK'), recommendations }
    }

    onResult({ parsed, byDate, dates })

    setStatus('loaded')
    setSummary(
      `${parsed.stores.length} stores · ${parsed.workers.length} workers · ${parsed.shifts.length} shifts · ${dates.length} days · ${totalGaps} gaps`,
    )
    setErrors(parsed.errors)
  }

  async function handleFile(
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'schedule' | 'roster' | 'orders',
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const entry = { name: file.name, buffer }

    const newSchedule = type === 'schedule' ? entry : scheduleFile
    const newRoster = type === 'roster' ? entry : rosterFile
    const newOrders = type === 'orders' ? entry : ordersFile

    if (type === 'schedule') setScheduleFile(entry)
    if (type === 'roster') setRosterFile(entry)
    if (type === 'orders') setOrdersFile(entry)

    // Re-run engines whenever we have at least a schedule
    if (newSchedule) {
      // Small delay to let state update
      setTimeout(() => runAll(newSchedule, newRoster, newOrders), 0)
    }

    // Reset input
    e.target.value = ''
  }

  const fileLabel = (f: FileEntry | null, fallback: string) =>
    f ? `✓ ${f.name.length > 20 ? f.name.slice(0, 20) + '…' : f.name}` : fallback

  return (
    <Box
      sx={{
        border: `1px dashed ${status === 'error' ? t.accent.decline : t.border.strong}`,
        borderRadius: 1.5,
        px: 2.5,
        py: 2,
        bgcolor: t.bg.secondary,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {status === 'loaded' ? (
            <CheckCircleIcon sx={{ fontSize: 20, color: t.accent.primary }} />
          ) : (
            <UploadFileIcon sx={{ fontSize: 20, color: t.text.tertiary }} />
          )}
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: t.text.primary }}>
              {status === 'loaded' ? 'Data loaded' : 'Upload WIW exports'}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: t.text.tertiary }}>
              {status === 'loaded' ? summary : 'Shifts + Roster + Orders'}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {([
            { type: 'schedule' as const, file: scheduleFile, label: 'Shifts', accept: '.xlsx,.xls', ref: scheduleRef },
            { type: 'roster' as const, file: rosterFile, label: 'Roster', accept: '.xlsx,.xls', ref: rosterRef },
            { type: 'orders' as const, file: ordersFile, label: 'Orders', accept: '.csv', ref: ordersRef },
          ]).map(({ type, file, label, accept, ref }) => (
            <Button
              key={type}
              variant="outlined"
              size="small"
              onClick={() => ref.current?.click()}
              sx={{
                borderColor: file ? t.accent.primary : t.border.strong,
                color: file ? t.accent.primary : t.text.secondary,
                fontWeight: 500,
                '&:hover': { borderColor: t.text.secondary, bgcolor: t.bg.tertiary },
              }}
            >
              {file ? `✓ ${label}` : label}
            </Button>
          ))}
        </Box>

        <input ref={scheduleRef} type="file" accept=".xlsx,.xls" onChange={(e) => handleFile(e, 'schedule')} style={{ display: 'none' }} />
        <input ref={rosterRef} type="file" accept=".xlsx,.xls" onChange={(e) => handleFile(e, 'roster')} style={{ display: 'none' }} />
        <input ref={ordersRef} type="file" accept=".csv" onChange={(e) => handleFile(e, 'orders')} style={{ display: 'none' }} />
      </Box>

      {errors.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography
            onClick={() => setShowErrors(!showErrors)}
            sx={{
              fontSize: '0.6875rem',
              color: status === 'error' ? t.accent.decline : t.text.tertiary,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {errors.length} warning{errors.length > 1 ? 's' : ''} {showErrors ? '▾' : '▸'}
          </Typography>
          <Collapse in={showErrors}>
            <Box sx={{ mt: 0.5, maxHeight: 150, overflow: 'auto' }}>
              {errors.map((e, i) => (
                <Typography key={i} sx={{ fontSize: '0.6875rem', color: t.text.tertiary }}>
                  {e}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  )
}
