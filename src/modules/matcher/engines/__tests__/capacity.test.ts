import { describe, it, expect } from 'vitest'
import { workerCapacity, overlapHours, shopperSupply, driverSupply } from '../capacity'
import {
  windowMorning,
  fixedShopper,
  driver,
  mariaMorningShift,
  alexDriverShift,
  makeShift,
  floaterShopper,
} from './fixtures'

describe('workerCapacity', () => {
  it('calculates UPH × (hours − 0.5)', () => {
    expect(workerCapacity(52, 2)).toBe(78) // 52 × 1.5
  })

  it('caps at 400', () => {
    expect(workerCapacity(100, 6)).toBe(400) // 100 × 5.5 = 550 → 400
  })

  it('returns 0 for overlap ≤ 0.5 hours', () => {
    expect(workerCapacity(52, 0.5)).toBe(0)
    expect(workerCapacity(52, 0.3)).toBe(0)
  })

  it('returns 0 for 0 UPH', () => {
    expect(workerCapacity(0, 2)).toBe(0)
  })

  it('handles fractional hours', () => {
    expect(workerCapacity(50, 1.75)).toBe(62.5) // 50 × 1.25
  })

  it('returns exactly 400 at the cap boundary', () => {
    // UPH=400, hours=1.5 → 400 × 1.0 = 400 (exactly at cap)
    expect(workerCapacity(400, 1.5)).toBe(400)
  })
})

describe('overlapHours', () => {
  it('full overlap', () => {
    expect(overlapHours('08:00', '10:00', '08:00', '10:00')).toBe(2)
  })

  it('partial overlap — shift starts before window', () => {
    expect(overlapHours('07:00', '09:00', '08:00', '10:00')).toBe(1)
  })

  it('partial overlap — shift ends after window', () => {
    expect(overlapHours('09:00', '11:00', '08:00', '10:00')).toBe(1)
  })

  it('no overlap', () => {
    expect(overlapHours('06:00', '07:00', '08:00', '10:00')).toBe(0)
  })

  it('shift contains window', () => {
    expect(overlapHours('07:00', '11:00', '08:00', '10:00')).toBe(2)
  })

  it('adjacent — no overlap', () => {
    expect(overlapHours('06:00', '08:00', '08:00', '10:00')).toBe(0)
  })
})

describe('shopperSupply', () => {
  it('calculates total shopper units for a window', () => {
    const supply = shopperSupply(windowMorning, [mariaMorningShift], [fixedShopper])
    // Maria: 52 UPH × (2h - 0.5) = 78 units
    expect(supply).toBe(78)
  })

  it('sums multiple shoppers', () => {
    const samShift = makeShift({
      workerId: floaterShopper.id,
      storeId: 'store-a',
      startTime: '08:00',
      endTime: '10:00',
      netHours: 1.5,
    })
    const supply = shopperSupply(
      windowMorning,
      [mariaMorningShift, samShift],
      [fixedShopper, floaterShopper],
    )
    // Maria: 78 + Sam: 48 × 1.5 = 72 → total 150
    expect(supply).toBe(150)
  })

  it('ignores non-shopper workers', () => {
    const supply = shopperSupply(windowMorning, [alexDriverShift], [driver])
    expect(supply).toBe(0)
  })

  it('ignores non-SCHEDULED shifts', () => {
    const calledOut = { ...mariaMorningShift, status: 'CALLED_OUT' as const }
    const supply = shopperSupply(windowMorning, [calledOut], [fixedShopper])
    expect(supply).toBe(0)
  })

  it('returns 0 when no shifts', () => {
    expect(shopperSupply(windowMorning, [], [fixedShopper])).toBe(0)
  })
})

describe('driverSupply', () => {
  it('counts drivers covering delivery window', () => {
    const count = driverSupply(windowMorning, [alexDriverShift], [driver])
    expect(count).toBe(1)
  })

  it('returns 0 when no drivers scheduled', () => {
    expect(driverSupply(windowMorning, [mariaMorningShift], [fixedShopper])).toBe(0)
  })

  it('ignores CALLED_OUT driver shifts', () => {
    const calledOut = { ...alexDriverShift, status: 'CALLED_OUT' as const }
    expect(driverSupply(windowMorning, [calledOut], [driver])).toBe(0)
  })
})
