import type { Worker, Shift, DeliveryWindow } from '../types'

const MAX_CAPACITY_PER_WORKER = 400

/**
 * Calculate a single worker's capacity for a window in units.
 * Formula: UPH × (overlapHours − 0.5), capped at 400.
 */
export function workerCapacity(uphAvg: number, overlapHours: number): number {
  const effective = overlapHours - 0.5
  if (effective <= 0) return 0
  return Math.min(uphAvg * effective, MAX_CAPACITY_PER_WORKER)
}

/**
 * Calculate hours of overlap between a shift and a time range (shopping window).
 * All times as "HH:mm" strings on the same day.
 */
export function overlapHours(
  shiftStart: string,
  shiftEnd: string,
  windowStart: string,
  windowEnd: string,
): number {
  const s1 = minutesFromMidnight(shiftStart)
  const s2 = minutesFromMidnight(shiftEnd)
  const w1 = minutesFromMidnight(windowStart)
  const w2 = minutesFromMidnight(windowEnd)

  const overlapStart = Math.max(s1, w1)
  const overlapEnd = Math.min(s2, w2)
  const minutes = Math.max(0, overlapEnd - overlapStart)
  return minutes / 60
}

/**
 * Total shopper supply in units for a delivery window.
 */
export function shopperSupply(
  window: DeliveryWindow,
  shifts: Shift[],
  workers: Worker[],
): number {
  const workerMap = new Map(workers.map((w) => [w.id, w]))
  let total = 0

  for (const shift of shifts) {
    if (shift.status !== 'SCHEDULED') continue
    const worker = workerMap.get(shift.workerId)
    if (!worker) continue
    if (worker.role !== 'SHOPPER' && worker.role !== 'BOTH') continue

    const hours = overlapHours(
      shift.startTime,
      shift.endTime,
      window.shopStartTime,
      window.shopEndTime,
    )
    total += workerCapacity(worker.uphAvg, hours)
  }

  return Math.round(total)
}

/**
 * Count of drivers assigned to a delivery window.
 */
export function driverSupply(
  window: DeliveryWindow,
  shifts: Shift[],
  workers: Worker[],
): number {
  const workerMap = new Map(workers.map((w) => [w.id, w]))
  let count = 0

  for (const shift of shifts) {
    if (shift.status !== 'SCHEDULED') continue
    const worker = workerMap.get(shift.workerId)
    if (!worker) continue
    if (worker.role !== 'DRIVER' && worker.role !== 'BOTH') continue

    const hours = overlapHours(
      shift.startTime,
      shift.endTime,
      window.startTime,
      window.endTime,
    )
    if (hours > 0) count++
  }

  return count
}

function minutesFromMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
