import type {
  ThresholdResult,
  AvailableWorker,
  MatchResult,
  RecommendationCandidate,
  ConsolidationTarget,
  DeliveryWindow,
  Worker,
  Shift,
} from '../types'
import { workerCapacity, overlapHours } from './capacity'

/**
 * Match available workers to a gap. Pure function.
 *
 * Priority order (enforced):
 * 1. Same-store fixed employee
 * 2. Floater
 * 3. Flex employee (approved stores only)
 * 4. Shift lead
 * 5. Consolidate
 * 6. Escalate
 */
export function matchWorkers(
  gap: ThresholdResult,
  available: AvailableWorker[],
  window: DeliveryWindow,
  adjacentWindows?: { window: DeliveryWindow; remainingCapacity: number }[],
): MatchResult {
  const needsShoppers = gap.shopperGap > 0
  const needsDrivers = gap.driverGap > 0

  const filtered = available.filter((aw) => {
    if (aw.hasConflictingShift) return false
    const w = aw.worker
    // Role must match gap type
    if (needsShoppers && !needsDrivers && w.role === 'DRIVER') return false
    if (needsDrivers && !needsShoppers && w.role === 'SHOPPER') return false
    // Store eligibility
    if (w.approvedStoreIds.length > 0 && !w.approvedStoreIds.includes(gap.storeId)) return false
    return true
  })

  const ranked = filtered
    .map((aw) => ({
      aw,
      priority: workerPriority(aw.worker, gap.storeId, aw.alreadyAtDifferentStore),
    }))
    .filter((r) => r.priority <= 5) // only real worker matches (exclude priority 99)
    .sort((a, b) => {
      // Primary: priority tier
      if (a.priority !== b.priority) return a.priority - b.priority
      // Tiebreak 1: fewest hours scheduled today
      if (a.aw.hoursScheduledToday !== b.aw.hoursScheduledToday)
        return a.aw.hoursScheduledToday - b.aw.hoursScheduledToday
      // Tiebreak 2: highest UPH (for shoppers)
      return b.aw.worker.uphAvg - a.aw.worker.uphAvg
    })

  const recommendations: RecommendationCandidate[] = ranked.map((r) => {
    const w = r.aw.worker
    const role = needsDrivers && (w.role === 'DRIVER' || w.role === 'BOTH')
      ? 'DRIVER' as const
      : 'SHOPPER' as const

    const typeLabel = w.type === 'FIXED' && r.aw.isAtHomeStore ? 'Fixed (home store)'
      : w.type === 'FIXED' ? 'Fixed (other store)'
      : w.type.charAt(0) + w.type.slice(1).toLowerCase()
    // Capacity is based on the actual window duration, not total remaining hours
    const windowHours = overlapHours(
      window.shopStartTime, window.shopEndTime,
      window.shopStartTime, window.shopEndTime,
    )
    const capacity = role === 'SHOPPER'
      ? workerCapacity(w.uphAvg, windowHours)
      : 1
    const availHours = 8 - r.aw.hoursScheduledToday

    return {
      workerId: w.id,
      workerName: w.name,
      role,
      priority: r.priority,
      reason: `${typeLabel}${r.aw.isAtHomeStore ? ' (home store)' : ''}, ${w.uphAvg} UPH, ${availHours.toFixed(1)}h available`,
      capacityAdded: Math.round(capacity),
    }
  })

  // Consolidation targets if no workers
  const consolidationTargets: ConsolidationTarget[] = []
  if (recommendations.length === 0 && adjacentWindows) {
    for (const aw of adjacentWindows) {
      if (aw.remainingCapacity >= gap.shopperDemand) {
        consolidationTargets.push({
          windowId: aw.window.id,
          remainingCapacity: aw.remainingCapacity,
          window: aw.window,
        })
      }
    }
  }

  let fallback: MatchResult['fallback'] = null
  if (recommendations.length === 0) {
    fallback = consolidationTargets.length > 0 ? 'CONSOLIDATE' : 'ESCALATE'
  }

  return { recommendations, fallback, consolidationTargets }
}

/**
 * Filter workers by availability constraints (break policy, daily max, conflicts).
 * Pure function — transforms raw worker + shift data into AvailableWorker[].
 */
export function filterAvailableWorkers(
  workers: Worker[],
  allShifts: Shift[],
  targetWindow: DeliveryWindow,
  targetDate: string,
): AvailableWorker[] {
  const result: AvailableWorker[] = []

  for (const worker of workers) {
    const todayShifts = allShifts.filter(
      (s) => s.workerId === worker.id && s.date === targetDate && s.status === 'SCHEDULED',
    )

    const hoursScheduledToday = todayShifts.reduce((sum, s) => sum + s.netHours, 0)

    // Daily max: 8 hours
    // We estimate the gap shift would be ~2 hours (shopping window duration)
    const gapHours = 2
    if (hoursScheduledToday + gapHours > 8) continue

    // Break policy: if total > 6h, must have 1hr break scheduled
    // For simplicity in V1: if adding this shift would push over 6h, flag as unavailable
    // unless they already have enough break time built in
    if (hoursScheduledToday + gapHours > 6) {
      // Check if they have a gap between shifts that could serve as break
      const hasBreakWindow = checkBreakAvailability(todayShifts, gapHours)
      if (!hasBreakWindow) continue
    }

    // Check for conflicting shifts (overlap with target window's shop or delivery period)
    const hasConflict = todayShifts.some((s) => {
      const shopOverlap = overlapHours(
        s.startTime,
        s.endTime,
        targetWindow.shopStartTime,
        targetWindow.shopEndTime,
      )
      const deliveryOverlap = overlapHours(
        s.startTime,
        s.endTime,
        targetWindow.startTime,
        targetWindow.endTime,
      )
      return shopOverlap > 0 || deliveryOverlap > 0
    })

    const storesWorkedToday = new Set(todayShifts.map((s) => s.storeId))
    result.push({
      worker,
      hoursScheduledToday,
      hasConflictingShift: hasConflict,
      isAtHomeStore: worker.homeStoreId === targetWindow.storeId,
      alreadyAtDifferentStore: storesWorkedToday.size > 0 && !storesWorkedToday.has(targetWindow.storeId) && worker.type === 'FIXED',
    })
  }

  return result
}

export interface FilteredOutWorker {
  workerName: string
  workerRole: string
  workerType: string
  reason: string
}

/**
 * Like filterAvailableWorkers but also returns WHY excluded workers were filtered out.
 */
export function filterWithReasons(
  workers: Worker[],
  allShifts: Shift[],
  targetWindow: DeliveryWindow,
  targetDate: string,
  gapStoreId: string,
  gapClusterId: string,
  needsShoppers: boolean,
  needsDrivers: boolean,
): { available: AvailableWorker[]; excluded: FilteredOutWorker[] } {
  const available: AvailableWorker[] = []
  const excluded: FilteredOutWorker[] = []

  for (const worker of workers) {
    const name = worker.name
    const role = worker.role
    const type = worker.type

    // 1. Store eligibility — biggest filter, check first
    if (worker.approvedStoreIds.length > 0 && !worker.approvedStoreIds.includes(gapStoreId)) {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: 'Not eligible for this store' })
      continue
    }

    // 2. Region/cluster — worker must be in the same cluster as the gap store
    if (gapClusterId && worker.clusterId !== gapClusterId) {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: `Different region (${worker.clusterId})` })
      continue
    }

    // 3. Role mismatch
    if (needsShoppers && !needsDrivers && role === 'DRIVER') {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: 'Role mismatch (driver, need shopper)' })
      continue
    }
    if (needsDrivers && !needsShoppers && role === 'SHOPPER') {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: 'Role mismatch (shopper, need driver)' })
      continue
    }

    // 4. Schedule conflict — check before hours since it's a hard block
    const todayShifts = allShifts.filter(
      (s) => s.workerId === worker.id && s.date === targetDate && s.status === 'SCHEDULED',
    )

    const hasConflict = todayShifts.some((s) => {
      const shopOverlap = overlapHours(s.startTime, s.endTime, targetWindow.shopStartTime, targetWindow.shopEndTime)
      const deliveryOverlap = overlapHours(s.startTime, s.endTime, targetWindow.startTime, targetWindow.endTime)
      return shopOverlap > 0 || deliveryOverlap > 0
    })

    if (hasConflict) {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: 'Schedule conflict with this window' })
      continue
    }

    // 5. Daily hours max
    const hoursScheduledToday = todayShifts.reduce((sum, s) => sum + s.netHours, 0)
    const gapHours = 2
    if (hoursScheduledToday + gapHours > 8) {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: `Daily hours maxed (${hoursScheduledToday.toFixed(1)}h + ${gapHours}h > 8h)` })
      continue
    }

    // 6. Break policy
    if (hoursScheduledToday + gapHours > 6) {
      const hasBreak = checkBreakAvailability(todayShifts, gapHours)
      if (!hasBreak) {
        excluded.push({ workerName: name, workerRole: role, workerType: type, reason: `Break policy (${hoursScheduledToday.toFixed(1)}h + ${gapHours}h > 6h, no break window)` })
        continue
      }
    }

    // FT workers not scheduled today are excluded — need outreach, treat like Flex
    const isScheduledToday = todayShifts.length > 0
    if (worker.type === 'FIXED' && !isScheduledToday) {
      excluded.push({ workerName: name, workerRole: role, workerType: type, reason: 'Fixed worker not scheduled today' })
      continue
    }

    // Check if this worker already has shifts at a different store today (one-move-per-day rule)
    const storesWorkedToday = new Set(todayShifts.map((s) => s.storeId))
    const alreadyAtDifferentStore = storesWorkedToday.size > 0 &&
      !storesWorkedToday.has(gapStoreId) &&
      worker.type === 'FIXED'

    // Check if this worker already has a shift that FULLY covers this window's shopping period.
    // A shift supports a window only if it completely contains the shopping period.
    // No partial coverage — the shift must start at or before shopStartTime
    // and end at or after shopEndTime.
    const alreadySupportsWindow = todayShifts.some((s) => {
      if (s.storeId !== targetWindow.storeId) return false
      const shiftStart = timeToMinutes(s.startTime)
      const shiftEnd = timeToMinutes(s.endTime)
      const shopStart = timeToMinutes(targetWindow.shopStartTime)
      const shopEnd = timeToMinutes(targetWindow.shopEndTime)
      return shiftStart <= shopStart && shiftEnd >= shopEnd
    })

    if (alreadySupportsWindow) {
      excluded.push({
        workerName: name, workerRole: role, workerType: type,
        reason: 'Already scheduled for this window (capacity counted)',
      })
      continue
    }

    available.push({
      worker,
      hoursScheduledToday,
      hasConflictingShift: false,
      isAtHomeStore: worker.homeStoreId === targetWindow.storeId,
      alreadyAtDifferentStore,
    })
  }

  return { available, excluded }
}

function workerPriority(worker: Worker, storeId: string, alreadyAtDifferentStore: boolean): number {
  // 1. Floater — designed to move, already on schedule, known availability
  if (worker.type === 'FLOATER') return 1
  // 2. Shift Lead — already on schedule at store, can plug gaps immediately
  if (worker.type === 'SHIFT_LEAD') return 2
  // 3. Flex — eligible but needs Twilio outreach, confirmation delay
  if (worker.type === 'FLEX') return 3
  // 4. Fixed at same store — scheduled today, available for other windows
  if (worker.type === 'FIXED' && worker.homeStoreId === storeId) return 4
  // 5. Fixed at neighboring store — gap store in their WIW Schedules, not already at another store
  if (worker.type === 'FIXED' && !alreadyAtDifferentStore) return 5
  // Fixed already at a different store today — one move per day rule
  if (worker.type === 'FIXED' && alreadyAtDifferentStore) return 99
  return 99
}

function checkBreakAvailability(shifts: Shift[], additionalHours: number): boolean {
  if (shifts.length === 0) return true
  // Simple heuristic: if there's at least 1 hour gap between existing shifts,
  // assume break can be scheduled
  const sorted = [...shifts].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  )
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = overlapHours(sorted[i].endTime, sorted[i + 1].startTime, sorted[i].endTime, sorted[i + 1].startTime)
    // Actually we just need to check the gap between end of one shift and start of next
    const endMins = timeToMinutes(sorted[i].endTime)
    const startMins = timeToMinutes(sorted[i + 1].startTime)
    if (startMins - endMins >= 60) return true
  }
  return false
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
