// ─── Domain Types ───────────────────────────────────────────────
// Pure types used by engines. Decoupled from Prisma for testability.

export type WorkerRole = 'SHOPPER' | 'DRIVER' | 'BOTH'
export type WorkerType = 'FIXED' | 'FLOATER' | 'FLEX' | 'SHIFT_LEAD'
export type ShiftStatus = 'SCHEDULED' | 'CALLED_OUT' | 'REMOVED' | 'NO_SHOW'
export type ThresholdState = 'OK' | 'WARNING' | 'CRITICAL' | 'GAP'
export type UrgencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type GapType = 'NONE' | 'SHOPPER_GAP' | 'DRIVER_GAP' | 'BOTH_GAP'
export type TriggerSource = 'ORDER_EVENT' | 'SHIFT_EVENT' | 'SCHEDULED_SCAN'
export type CardLane = 'NEEDS_ACTION' | 'IN_PROGRESS' | 'RESOLVED' | 'UNRESOLVED'

export interface Store {
  id: string
  name: string
  clusterId: string
  driverTarget: number
}

export interface DeliveryWindow {
  id: string
  storeId: string
  date: string          // ISO date
  startTime: string     // HH:mm (delivery start)
  endTime: string       // HH:mm (delivery end)
  shopStartTime: string // HH:mm (shopping start)
  shopEndTime: string   // HH:mm (shopping end)
}

export interface Worker {
  id: string
  wiwId: string
  name: string
  role: WorkerRole
  type: WorkerType
  homeStoreId: string
  clusterId: string
  approvedStoreIds: string[]
  uphAvg: number // 4-week rolling avg, shoppers only
}

export interface Shift {
  id: string
  workerId: string
  storeId: string
  date: string    // ISO date
  startTime: string // HH:mm
  endTime: string   // HH:mm
  netHours: number
  status: ShiftStatus
}

// ─── Threshold Config ───────────────────────────────────────────

export interface ThresholdConfig {
  shopper: {
    warning: number  // e.g. 0.75 — warn when demand reaches 75% of supply
    critical: number // e.g. 0.90 — critical at 90%
  }
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  shopper: {
    warning: 0.75,
    critical: 0.90,
  },
}

// ─── Engine I/O Types ───────────────────────────────────────────

export interface WindowEvalInput {
  window: DeliveryWindow
  shifts: Shift[]         // SCHEDULED only for this window
  workers: Worker[]       // workers with UPH for capacity calc
  orderVolume: number     // current order units for this window
  driverTarget: number    // from store config
  now: Date               // for time-based urgency
}

export interface ThresholdResult {
  windowId: string
  storeId: string
  shopperSupply: number
  shopperDemand: number
  shopperGap: number
  shopperUtilPct: number  // demand / supply (Infinity if supply = 0)
  driverSupply: number
  driverTarget: number
  driverGap: number
  thresholdState: ThresholdState
  urgency: UrgencyLevel
  gapType: GapType
  shouldCreateCard: boolean
  shouldUpdateCard: boolean
  shouldAutoResolve: boolean
}

export interface AvailableWorker {
  worker: Worker
  hoursScheduledToday: number
  hasConflictingShift: boolean
  isAtHomeStore: boolean
  alreadyAtDifferentStore: boolean // has shifts at a non-gap store today
}

export interface ConsolidationTarget {
  windowId: string
  remainingCapacity: number
  window: DeliveryWindow
}

export interface MatchResult {
  recommendations: RecommendationCandidate[]
  fallback: 'CONSOLIDATE' | 'ESCALATE' | null
  consolidationTargets: ConsolidationTarget[]
}

export interface RecommendationCandidate {
  workerId: string
  workerName: string
  role: WorkerRole
  priority: number
  reason: string
  capacityAdded: number // units this worker would add (shoppers) or 1 (drivers)
}

export interface ClusterEvalInput {
  clusterId: string
  windows: DeliveryWindow[]
  shifts: Shift[]
  workers: Worker[]
  stores: Store[]
  orderVolumes: Map<string, number> // windowId → units
  now: Date
  thresholds: ThresholdConfig
}

export interface ClusterEvalResult {
  windowResults: ThresholdResult[]
  supplyPosition: SupplyPosition
}

export interface SupplyPosition {
  shopperSupply: number
  shopperDemand: number
  driverSupply: number
  driverDemand: number
  windowsAtRisk: number
  flexPoolTotal: number
  flexPoolDeployed: number
  gapBreakdown: { shopper: number; driver: number; both: number }
}
