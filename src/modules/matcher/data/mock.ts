// ─── Types for UI layer ─────────────────────────────────────────

export type IssueType = 'Call-out' | 'Understaffed' | 'Driver missing'
export type RecommendationType = 'MOVE' | 'ACTIVATE' | 'ASSIGN' | 'CONSOLIDATE' | 'ESCALATE'
export type CardStatus = 'needs_action' | 'awaiting_response' | 'resolved'
export type WindowHealth = 'covered' | 'at_risk' | 'gap'

export interface ActionCard {
  id: string
  issueType: IssueType
  recommendation: RecommendationType
  storeName: string
  windowTime: string
  description: string
  acceptLabel: string
  status: CardStatus
  dayOffset: number
  windowId?: string
  units?: number
  priorityScore?: number
  priorityLabel?: 'Critical' | 'High' | 'Medium' | 'Low'
  debug?: {
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
    allCandidates: {
      workerName: string
      workerType: string
      workerRole: string
      priority: number
      reason: string
      capacityAdded: number
      isTopPick: boolean
    }[]
    excluded: {
      workerName: string
      workerType: string
      workerRole: string
      reason: string
    }[]
    fallback: string | null
    filterReasons: string[]
  }
}

// ─── Store window health grid ───────────────────────────────────

export interface StoreWindowHealth {
  storeId: string
  storeName: string
  windows: WindowHealthEntry[]
}

export interface WindowHealthEntry {
  id: string
  time: string
  health: WindowHealth
  maxCapacity: number
  units: number
  orders: number
  maxOrderCapacity: number
  isOpen: boolean
  atOrderCap: boolean
  driverOk: boolean
}
