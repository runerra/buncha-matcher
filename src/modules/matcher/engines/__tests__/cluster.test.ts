import { describe, it, expect } from 'vitest'
import { evaluateCluster } from '../cluster'
import type { ClusterEvalInput } from '../../types'
import {
  storeA,
  storeB,
  windowMorning,
  windowStoreB,
  fixedShopper,
  floaterShopper,
  flexShopper,
  driver,
  mariaMorningShift,
  alexDriverShift,
  makeShift,
  nowAt,
} from './fixtures'
import { DEFAULT_THRESHOLDS } from '../../types'

function makeClusterInput(overrides: Partial<ClusterEvalInput> = {}): ClusterEvalInput {
  return {
    clusterId: 'detroit',
    windows: [windowMorning, windowStoreB],
    shifts: [mariaMorningShift, alexDriverShift],
    workers: [fixedShopper, floaterShopper, flexShopper, driver],
    stores: [storeA, storeB],
    orderVolumes: new Map([
      [windowMorning.id, 50],
      [windowStoreB.id, 100],
    ]),
    now: nowAt('06:00'),
    thresholds: DEFAULT_THRESHOLDS,
    ...overrides,
  }
}

describe('evaluateCluster', () => {
  it('evaluates all windows', () => {
    const result = evaluateCluster(makeClusterInput())
    expect(result.windowResults).toHaveLength(2)
  })

  it('correctly identifies gaps per window', () => {
    const result = evaluateCluster(makeClusterInput())

    const morningResult = result.windowResults.find((r) => r.windowId === windowMorning.id)!
    expect(morningResult.shopperSupply).toBe(78) // Maria: 52 × 1.5
    expect(morningResult.shopperDemand).toBe(50)
    expect(morningResult.thresholdState).toBe('OK') // 50/78 = 64% — below 75% warning threshold

    const storeBResult = result.windowResults.find((r) => r.windowId === windowStoreB.id)!
    // No shifts at store B → supply = 0, demand = 100 → GAP
    expect(storeBResult.thresholdState).toBe('GAP')
    expect(storeBResult.shopperGap).toBe(100)
  })

  it('aggregates supply position', () => {
    const result = evaluateCluster(makeClusterInput())
    const sp = result.supplyPosition

    expect(sp.shopperDemand).toBe(150) // 50 + 100
    expect(sp.windowsAtRisk).toBeGreaterThanOrEqual(1) // store B has a gap
    expect(sp.flexPoolTotal).toBe(1) // flexShopper
  })

  it('handles empty cluster', () => {
    const result = evaluateCluster(
      makeClusterInput({
        windows: [],
        shifts: [],
        workers: [],
        stores: [],
        orderVolumes: new Map(),
      }),
    )
    expect(result.windowResults).toHaveLength(0)
    expect(result.supplyPosition.windowsAtRisk).toBe(0)
  })

  it('counts flex pool deployment', () => {
    // Give flex worker a shift
    const flexShift = makeShift({
      workerId: flexShopper.id,
      storeId: 'store-a',
      startTime: '08:00',
      endTime: '10:00',
    })
    const result = evaluateCluster(
      makeClusterInput({
        shifts: [mariaMorningShift, alexDriverShift, flexShift],
      }),
    )
    expect(result.supplyPosition.flexPoolDeployed).toBe(1)
  })
})
