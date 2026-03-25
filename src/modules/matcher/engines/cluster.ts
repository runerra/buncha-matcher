import type {
  ClusterEvalInput,
  ClusterEvalResult,
  SupplyPosition,
  ThresholdResult,
} from '../types'
import { evaluateWindow } from './threshold'

/**
 * Evaluate all windows in a cluster. Pure function.
 * Returns per-window threshold results + aggregated supply position.
 */
export function evaluateCluster(input: ClusterEvalInput): ClusterEvalResult {
  const { windows, shifts, workers, stores, orderVolumes, now, thresholds } = input
  const storeMap = new Map(stores.map((s) => [s.id, s]))

  const windowResults: ThresholdResult[] = windows.map((window) => {
    const store = storeMap.get(window.storeId)!
    const windowShifts = shifts.filter(
      (s) => s.storeId === window.storeId && s.date === window.date && s.status === 'SCHEDULED',
    )
    const windowWorkerIds = new Set(windowShifts.map((s) => s.workerId))
    const windowWorkers = workers.filter((w) => windowWorkerIds.has(w.id))

    return evaluateWindow(
      {
        window,
        shifts: windowShifts,
        workers: windowWorkers,
        orderVolume: orderVolumes.get(window.id) ?? 0,
        driverTarget: store.driverTarget,
        now,
      },
      thresholds,
    )
  })

  const supplyPosition = aggregateSupplyPosition(windowResults, workers, shifts)

  return { windowResults, supplyPosition }
}

function aggregateSupplyPosition(
  results: ThresholdResult[],
  workers: import('../types').Worker[],
  shifts: import('../types').Shift[],
): SupplyPosition {
  let shopperSupply = 0
  let shopperDemand = 0
  let driverSupply = 0
  let driverDemand = 0
  let windowsAtRisk = 0
  let shopperGaps = 0
  let driverGaps = 0
  let bothGaps = 0

  for (const r of results) {
    shopperSupply += r.shopperSupply
    shopperDemand += r.shopperDemand
    driverSupply += r.driverSupply
    driverDemand += r.driverTarget
    if (r.thresholdState !== 'OK') windowsAtRisk++
    if (r.gapType === 'SHOPPER_GAP') shopperGaps++
    if (r.gapType === 'DRIVER_GAP') driverGaps++
    if (r.gapType === 'BOTH_GAP') bothGaps++
  }

  const flexWorkers = workers.filter((w) => w.type === 'FLEX')
  const flexTotal = flexWorkers.length
  const deployedFlexIds = new Set(
    shifts
      .filter((s) => s.status === 'SCHEDULED')
      .map((s) => s.workerId),
  )
  const flexPoolDeployed = flexWorkers.filter((w) => deployedFlexIds.has(w.id)).length

  return {
    shopperSupply,
    shopperDemand,
    driverSupply,
    driverDemand,
    windowsAtRisk,
    flexPoolTotal: flexTotal,
    flexPoolDeployed,
    gapBreakdown: { shopper: shopperGaps, driver: driverGaps, both: bothGaps },
  }
}
