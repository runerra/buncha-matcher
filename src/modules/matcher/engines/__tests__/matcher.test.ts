import { describe, it, expect } from 'vitest'
import { matchWorkers, filterAvailableWorkers } from '../matcher'
import type { ThresholdResult, AvailableWorker } from '../../types'
import {
  windowMorning,
  windowAfternoon,
  windowEvening,
  fixedShopper,
  floaterShopper,
  flexShopper,
  flexShopperNoApproval,
  shiftLead,
  driver,
  makeShift,
  allWorkers,
} from './fixtures'

function makeGap(overrides: Partial<ThresholdResult> = {}): ThresholdResult {
  return {
    windowId: 'win-morning',
    storeId: 'store-a',
    shopperSupply: 78,
    shopperDemand: 200,
    shopperGap: 122,
    shopperUtilPct: 2.56,
    driverSupply: 1,
    driverTarget: 1,
    driverGap: 0,
    thresholdState: 'GAP',
    urgency: 'CRITICAL',
    gapType: 'SHOPPER_GAP',
    shouldCreateCard: true,
    shouldUpdateCard: true,
    shouldAutoResolve: false,
    ...overrides,
  }
}

function makeAvailable(
  workers: typeof fixedShopper[],
  overrides: Partial<AvailableWorker> = {},
): AvailableWorker[] {
  return workers.map((w) => ({
    worker: w,
    hoursScheduledToday: 0,
    hasConflictingShift: false,
    isAtHomeStore: w.homeStoreId === 'store-a',
    alreadyAtDifferentStore: false,
    ...overrides,
  }))
}

describe('matchWorkers — priority order', () => {
  // Priority: Floater (1) → Shift Lead (2) → Flex (3) → Fixed same store (4) → Fixed neighboring (5)

  it('ranks floater first', () => {
    const available = makeAvailable([fixedShopper, floaterShopper, flexShopper, shiftLead])
    const result = matchWorkers(makeGap(), available, windowMorning)

    expect(result.recommendations[0].workerId).toBe(floaterShopper.id)
    expect(result.recommendations[0].priority).toBe(1)
  })

  it('ranks shift lead second', () => {
    const available = makeAvailable([flexShopper, fixedShopper, shiftLead])
    const result = matchWorkers(makeGap(), available, windowMorning)

    expect(result.recommendations[0].workerId).toBe(shiftLead.id)
    expect(result.recommendations[0].priority).toBe(2)
  })

  it('ranks flex third', () => {
    const available = makeAvailable([flexShopper, fixedShopper])
    const result = matchWorkers(makeGap(), available, windowMorning)

    expect(result.recommendations[0].workerId).toBe(flexShopper.id)
    expect(result.recommendations[0].priority).toBe(3)
  })

  it('ranks fixed same store fourth', () => {
    const available = makeAvailable([fixedShopper])
    const result = matchWorkers(makeGap(), available, windowMorning)

    expect(result.recommendations[0].workerId).toBe(fixedShopper.id)
    expect(result.recommendations[0].priority).toBe(4)
  })

  it('returns full priority order when all available', () => {
    const available = makeAvailable([shiftLead, floaterShopper, fixedShopper, flexShopper])
    const result = matchWorkers(makeGap(), available, windowMorning)

    const ids = result.recommendations.map((r) => r.workerId)
    expect(ids).toEqual([floaterShopper.id, shiftLead.id, flexShopper.id, fixedShopper.id])
  })
})

describe('matchWorkers — filtering', () => {
  it('excludes workers with conflicting shifts', () => {
    const available = makeAvailable([fixedShopper]).map((aw) => ({
      ...aw,
      hasConflictingShift: true,
    }))
    const result = matchWorkers(makeGap(), available, windowMorning)
    expect(result.recommendations).toHaveLength(0)
  })

  it('excludes flex workers not approved for the store', () => {
    const available = makeAvailable([flexShopperNoApproval])
    const result = matchWorkers(makeGap(), available, windowMorning)
    expect(result.recommendations).toHaveLength(0)
  })

  it('includes flex workers approved for the store', () => {
    const available = makeAvailable([flexShopper])
    const result = matchWorkers(makeGap(), available, windowMorning)
    expect(result.recommendations).toHaveLength(1)
  })

  it('excludes pure drivers for shopper-only gap', () => {
    const available = makeAvailable([driver])
    const gap = makeGap({ gapType: 'SHOPPER_GAP', driverGap: 0 })
    const result = matchWorkers(gap, available, windowMorning)
    expect(result.recommendations).toHaveLength(0)
  })

  it('includes drivers for driver gap', () => {
    const available = makeAvailable([driver])
    const gap = makeGap({
      gapType: 'DRIVER_GAP',
      shopperGap: 0,
      driverGap: 1,
      driverSupply: 0,
    })
    const result = matchWorkers(gap, available, windowMorning)
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].role).toBe('DRIVER')
  })
})

describe('matchWorkers — tiebreaking', () => {
  it('prefers worker with fewer hours scheduled', () => {
    const a1: AvailableWorker = {
      worker: { ...floaterShopper, id: 'floater-1', name: 'Floater A' },
      hoursScheduledToday: 4,
      hasConflictingShift: false,
      isAtHomeStore: false,
      alreadyAtDifferentStore: false,
    }
    const a2: AvailableWorker = {
      worker: { ...floaterShopper, id: 'floater-2', name: 'Floater B' },
      hoursScheduledToday: 2,
      hasConflictingShift: false,
      isAtHomeStore: false,
      alreadyAtDifferentStore: false,
    }
    const result = matchWorkers(makeGap(), [a1, a2], windowMorning)
    expect(result.recommendations[0].workerId).toBe('floater-2')
  })

  it('prefers worker with higher UPH when hours are equal', () => {
    const a1: AvailableWorker = {
      worker: { ...floaterShopper, id: 'floater-1', uphAvg: 45 },
      hoursScheduledToday: 2,
      hasConflictingShift: false,
      isAtHomeStore: false,
      alreadyAtDifferentStore: false,
    }
    const a2: AvailableWorker = {
      worker: { ...floaterShopper, id: 'floater-2', uphAvg: 55 },
      hoursScheduledToday: 2,
      hasConflictingShift: false,
      isAtHomeStore: false,
      alreadyAtDifferentStore: false,
    }
    const result = matchWorkers(makeGap(), [a1, a2], windowMorning)
    expect(result.recommendations[0].workerId).toBe('floater-2')
  })
})

describe('matchWorkers — fallback', () => {
  it('suggests CONSOLIDATE when no workers but adjacent windows have capacity', () => {
    const result = matchWorkers(makeGap(), [], windowMorning, [
      { window: windowAfternoon, remainingCapacity: 300 },
    ])
    expect(result.fallback).toBe('CONSOLIDATE')
    expect(result.consolidationTargets).toHaveLength(1)
    expect(result.consolidationTargets[0].windowId).toBe(windowAfternoon.id)
  })

  it('filters out adjacent windows without enough capacity', () => {
    const result = matchWorkers(makeGap({ shopperDemand: 200 }), [], windowMorning, [
      { window: windowAfternoon, remainingCapacity: 50 }, // not enough
      { window: windowEvening, remainingCapacity: 250 },   // enough
    ])
    expect(result.consolidationTargets).toHaveLength(1)
    expect(result.consolidationTargets[0].windowId).toBe(windowEvening.id)
  })

  it('suggests ESCALATE when no workers and no viable consolidation', () => {
    const result = matchWorkers(makeGap(), [], windowMorning, [])
    expect(result.fallback).toBe('ESCALATE')
    expect(result.consolidationTargets).toHaveLength(0)
  })

  it('no fallback when workers are available', () => {
    const available = makeAvailable([fixedShopper])
    const result = matchWorkers(makeGap(), available, windowMorning)
    expect(result.fallback).toBeNull()
  })
})

describe('filterAvailableWorkers', () => {
  it('filters out workers with conflicting shifts', () => {
    const shifts = [
      makeShift({
        workerId: fixedShopper.id,
        storeId: 'store-a',
        startTime: '08:00',
        endTime: '10:00',
      }),
    ]
    const result = filterAvailableWorkers(
      [fixedShopper],
      shifts,
      windowMorning,
      '2026-03-20',
    )
    expect(result).toHaveLength(1)
    expect(result[0].hasConflictingShift).toBe(true)
  })

  it('excludes workers over daily max hours', () => {
    const shifts = [
      makeShift({
        workerId: fixedShopper.id,
        storeId: 'store-a',
        startTime: '00:00',
        endTime: '07:00',
        netHours: 7,
      }),
    ]
    // 7h already + 2h gap = 9h > 8h max
    const result = filterAvailableWorkers(
      [fixedShopper],
      shifts,
      windowMorning,
      '2026-03-20',
    )
    expect(result).toHaveLength(0)
  })

  it('includes workers with no scheduled shifts', () => {
    const result = filterAvailableWorkers(
      [fixedShopper],
      [],
      windowMorning,
      '2026-03-20',
    )
    expect(result).toHaveLength(1)
    expect(result[0].hoursScheduledToday).toBe(0)
    expect(result[0].hasConflictingShift).toBe(false)
  })

  it('marks home store correctly', () => {
    const result = filterAvailableWorkers(
      [fixedShopper, floaterShopper],
      [],
      windowMorning,
      '2026-03-20',
    )
    expect(result.find((r) => r.worker.id === fixedShopper.id)!.isAtHomeStore).toBe(true)
    expect(result.find((r) => r.worker.id === floaterShopper.id)!.isAtHomeStore).toBe(false)
  })
})
