import type {
  WindowEvalInput,
  ThresholdResult,
  ThresholdConfig,
  ThresholdState,
  UrgencyLevel,
  GapType,
} from '../types'
import { DEFAULT_THRESHOLDS } from '../types'
import { shopperSupply, driverSupply } from './capacity'

/**
 * Evaluate a single window against configurable thresholds.
 * Pure function — no side effects.
 */
export function evaluateWindow(
  input: WindowEvalInput,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): ThresholdResult {
  const { window, shifts, workers, orderVolume, driverTarget, now } = input

  const sSupply = shopperSupply(window, shifts, workers)
  const sDemand = orderVolume
  const sGap = Math.max(0, sDemand - sSupply)
  const sUtilPct = sSupply > 0 ? sDemand / sSupply : (sDemand > 0 ? Infinity : 0)

  const dSupply = driverSupply(window, shifts, workers)
  const dGap = Math.max(0, driverTarget - dSupply)

  const thresholdState = computeThresholdState(sSupply, sDemand, dGap, config)
  const gapType = computeGapType(sGap, dGap)
  const timeProximity = computeTimeProximity(window, now)
  const urgency = computeUrgency(thresholdState, timeProximity)

  return {
    windowId: window.id,
    storeId: window.storeId,
    shopperSupply: sSupply,
    shopperDemand: sDemand,
    shopperGap: sGap,
    shopperUtilPct: sUtilPct,
    driverSupply: dSupply,
    driverTarget,
    driverGap: dGap,
    thresholdState,
    urgency,
    gapType,
    shouldCreateCard: thresholdState !== 'OK',
    shouldUpdateCard: thresholdState !== 'OK', // urgency may have changed
    shouldAutoResolve: thresholdState === 'OK',
  }
}

function computeThresholdState(
  shopperSupply: number,
  shopperDemand: number,
  driverGap: number,
  _config: ThresholdConfig,
): ThresholdState {
  // GAP: demand exceeds supply — not enough workers to fill orders
  if (shopperSupply === 0 && shopperDemand > 0) return 'GAP'
  if (shopperDemand > shopperSupply) return 'GAP'

  // CRITICAL: driver gap (binary: met or not met)
  if (driverGap > 0) return 'CRITICAL'

  // If supply >= demand, window is covered — no action needed
  return 'OK'
}

function computeGapType(shopperGap: number, driverGap: number): GapType {
  if (shopperGap > 0 && driverGap > 0) return 'BOTH_GAP'
  if (shopperGap > 0) return 'SHOPPER_GAP'
  if (driverGap > 0) return 'DRIVER_GAP'
  return 'NONE'
}

type TimeProximity = 'UNDER_2H' | 'TODAY' | 'TOMORROW' | 'FUTURE'

function computeTimeProximity(
  window: { date: string; startTime: string },
  now: Date,
): TimeProximity {
  const windowDate = new Date(window.date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const diffDays = Math.floor(
    (windowDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (diffDays > 1) return 'FUTURE'
  if (diffDays === 1) return 'TOMORROW'

  // Same day — check hours
  const [h, m] = window.startTime.split(':').map(Number)
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  const hoursUntil = (windowStart.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (hoursUntil < 2) return 'UNDER_2H'
  return 'TODAY'
}

/**
 * Urgency matrix from plan §5:
 *
 * | Threshold State | > 24h | Tomorrow | Today | < 2h  |
 * |-----------------|-------|----------|-------|-------|
 * | WARNING         | LOW   | LOW      | MEDIUM| HIGH  |
 * | CRITICAL        | LOW   | MEDIUM   | HIGH  | CRIT  |
 * | GAP             | MEDIUM| HIGH     | CRIT  | CRIT  |
 */
function computeUrgency(
  state: ThresholdState,
  proximity: TimeProximity,
): UrgencyLevel {
  if (state === 'OK') return 'LOW'

  const matrix: Record<Exclude<ThresholdState, 'OK'>, Record<TimeProximity, UrgencyLevel>> = {
    WARNING: {
      FUTURE: 'LOW',
      TOMORROW: 'LOW',
      TODAY: 'MEDIUM',
      UNDER_2H: 'HIGH',
    },
    CRITICAL: {
      FUTURE: 'LOW',
      TOMORROW: 'MEDIUM',
      TODAY: 'HIGH',
      UNDER_2H: 'CRITICAL',
    },
    GAP: {
      FUTURE: 'MEDIUM',
      TOMORROW: 'HIGH',
      TODAY: 'CRITICAL',
      UNDER_2H: 'CRITICAL',
    },
  }

  return matrix[state][proximity]
}
