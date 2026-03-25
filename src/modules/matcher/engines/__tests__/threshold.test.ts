import { describe, it, expect } from 'vitest'
import { evaluateWindow } from '../threshold'
import type { ThresholdConfig } from '../../types'
import {
  windowMorning,
  fixedShopper,
  driver,
  mariaMorningShift,
  alexDriverShift,
  makeShift,
  floaterShopper,
  nowAt,
  nowTomorrow,
  nowFuture,
  storeA,
} from './fixtures'

const config: ThresholdConfig = {
  shopper: { warning: 0.75, critical: 0.90 },
}

function evalWindow(overrides: {
  shifts?: typeof mariaMorningShift[]
  workers?: typeof fixedShopper[]
  orderVolume?: number
  driverTarget?: number
  now?: Date
}) {
  return evaluateWindow(
    {
      window: windowMorning,
      shifts: overrides.shifts ?? [mariaMorningShift, alexDriverShift],
      workers: overrides.workers ?? [fixedShopper, driver],
      orderVolume: overrides.orderVolume ?? 50,
      driverTarget: overrides.driverTarget ?? 1,
      now: overrides.now ?? nowAt('06:00'),
    },
    config,
  )
}

describe('evaluateWindow — threshold states', () => {
  it('OK: supply well above demand', () => {
    const r = evalWindow({ orderVolume: 30 }) // 30/78 = 38% util
    expect(r.thresholdState).toBe('OK')
    expect(r.gapType).toBe('NONE')
    expect(r.shouldAutoResolve).toBe(true)
    expect(r.shouldCreateCard).toBe(false)
  })

  it('OK: supply covers demand even at high utilization', () => {
    // 60/78 = 77% — supply still exceeds demand, no action needed
    const r = evalWindow({ orderVolume: 60 })
    expect(r.thresholdState).toBe('OK')
    expect(r.shouldCreateCard).toBe(false)
  })

  it('OK: supply barely covers demand', () => {
    // 72/78 = 92% — tight but supply still covers
    const r = evalWindow({ orderVolume: 72 })
    expect(r.thresholdState).toBe('OK')
  })

  it('GAP: demand exceeds supply', () => {
    const r = evalWindow({ orderVolume: 100 }) // 100 > 78
    expect(r.thresholdState).toBe('GAP')
    expect(r.shopperGap).toBe(22)
    expect(r.gapType).toBe('SHOPPER_GAP')
  })

  it('CRITICAL: driver gap (driver target not met)', () => {
    const r = evalWindow({
      shifts: [mariaMorningShift], // no driver shift
      workers: [fixedShopper],
      orderVolume: 30,
      driverTarget: 1,
    })
    expect(r.thresholdState).toBe('CRITICAL')
    expect(r.driverGap).toBe(1)
    expect(r.gapType).toBe('DRIVER_GAP')
  })

  it('BOTH_GAP: shopper gap AND driver gap', () => {
    const r = evalWindow({
      shifts: [mariaMorningShift], // no driver
      workers: [fixedShopper],
      orderVolume: 100,
      driverTarget: 1,
    })
    expect(r.thresholdState).toBe('GAP')
    expect(r.gapType).toBe('BOTH_GAP')
  })

  it('GAP: zero supply with demand', () => {
    const r = evalWindow({
      shifts: [],
      workers: [],
      orderVolume: 100,
      driverTarget: 1,
    })
    expect(r.thresholdState).toBe('GAP')
    expect(r.shopperUtilPct).toBe(Infinity)
  })

  it('OK: zero supply zero demand', () => {
    const r = evalWindow({
      shifts: [],
      workers: [],
      orderVolume: 0,
      driverTarget: 0,
    })
    expect(r.thresholdState).toBe('OK')
  })
})

describe('evaluateWindow — urgency matrix', () => {
  // OK state — supply covers demand, always LOW regardless of time
  it('OK + today = LOW', () => {
    const r = evalWindow({ orderVolume: 60, now: nowAt('06:00') })
    expect(r.thresholdState).toBe('OK')
    expect(r.urgency).toBe('LOW')
  })

  it('OK + under 2h = LOW', () => {
    const r = evalWindow({ orderVolume: 60, now: nowAt('08:30') })
    expect(r.thresholdState).toBe('OK')
    expect(r.urgency).toBe('LOW')
  })

  // GAP state
  it('GAP + today = CRITICAL', () => {
    const r = evalWindow({ orderVolume: 100, now: nowAt('06:00') })
    expect(r.thresholdState).toBe('GAP')
    expect(r.urgency).toBe('CRITICAL')
  })

  it('GAP + future = MEDIUM', () => {
    const r = evalWindow({ orderVolume: 100, now: nowFuture() })
    expect(r.urgency).toBe('MEDIUM')
  })

  it('GAP + tomorrow = HIGH', () => {
    const r = evalWindow({ orderVolume: 100, now: nowTomorrow('09:00') })
    expect(r.urgency).toBe('HIGH')
  })
})

describe('evaluateWindow — supply/demand numbers', () => {
  it('calculates correct supply and demand', () => {
    const r = evalWindow({ orderVolume: 50 })
    expect(r.shopperSupply).toBe(78) // Maria: 52 × 1.5
    expect(r.shopperDemand).toBe(50)
    expect(r.shopperGap).toBe(0)
    expect(r.driverSupply).toBe(1)
    expect(r.driverTarget).toBe(1)
    expect(r.driverGap).toBe(0)
  })

  it('utilization percentage is correct', () => {
    const r = evalWindow({ orderVolume: 39 })
    expect(r.shopperUtilPct).toBeCloseTo(0.5, 1) // 39/78 = 0.5
  })
})
