import type { Worker, Shift, DeliveryWindow, Store } from '../../types'

// ─── Stores ─────────────────────────────────────────────────────
export const storeA: Store = {
  id: 'store-a',
  name: 'Store #1 - Dearborn',
  clusterId: 'detroit',
  driverTarget: 1,
}

export const storeB: Store = {
  id: 'store-b',
  name: 'Store #2 - Livonia',
  clusterId: 'detroit',
  driverTarget: 2,
}

// ─── Windows ────────────────────────────────────────────────────
export const windowMorning: DeliveryWindow = {
  id: 'win-morning',
  storeId: 'store-a',
  date: '2026-03-20',
  startTime: '10:00',
  endTime: '12:00',
  shopStartTime: '08:00',
  shopEndTime: '10:00',
}

export const windowAfternoon: DeliveryWindow = {
  id: 'win-afternoon',
  storeId: 'store-a',
  date: '2026-03-20',
  startTime: '12:00',
  endTime: '14:00',
  shopStartTime: '10:00',
  shopEndTime: '12:00',
}

export const windowEvening: DeliveryWindow = {
  id: 'win-evening',
  storeId: 'store-a',
  date: '2026-03-20',
  startTime: '16:00',
  endTime: '18:00',
  shopStartTime: '14:00',
  shopEndTime: '16:00',
}

export const windowStoreB: DeliveryWindow = {
  id: 'win-store-b',
  storeId: 'store-b',
  date: '2026-03-20',
  startTime: '10:00',
  endTime: '12:00',
  shopStartTime: '08:00',
  shopEndTime: '10:00',
}

// ─── Workers ────────────────────────────────────────────────────
export const fixedShopper: Worker = {
  id: 'w-fixed-shopper',
  wiwId: 'wiw-1',
  name: 'Maria J.',
  role: 'SHOPPER',
  type: 'FIXED',
  homeStoreId: 'store-a',
  clusterId: 'detroit',
  approvedStoreIds: [],
  uphAvg: 52,
}

export const floaterShopper: Worker = {
  id: 'w-floater',
  wiwId: 'wiw-2',
  name: 'Sam K.',
  role: 'SHOPPER',
  type: 'FLOATER',
  homeStoreId: 'store-b',
  clusterId: 'detroit',
  approvedStoreIds: [],
  uphAvg: 48,
}

export const flexShopper: Worker = {
  id: 'w-flex',
  wiwId: 'wiw-3',
  name: 'Alex R.',
  role: 'SHOPPER',
  type: 'FLEX',
  homeStoreId: 'store-b',
  clusterId: 'detroit',
  approvedStoreIds: ['store-a', 'store-b'],
  uphAvg: 45,
}

export const flexShopperNoApproval: Worker = {
  id: 'w-flex-no',
  wiwId: 'wiw-4',
  name: 'Chris P.',
  role: 'SHOPPER',
  type: 'FLEX',
  homeStoreId: 'store-b',
  clusterId: 'detroit',
  approvedStoreIds: ['store-b'], // not approved for store-a
  uphAvg: 50,
}

export const shiftLead: Worker = {
  id: 'w-lead',
  wiwId: 'wiw-5',
  name: 'Pat M.',
  role: 'BOTH',
  type: 'SHIFT_LEAD',
  homeStoreId: 'store-a',
  clusterId: 'detroit',
  approvedStoreIds: [],
  uphAvg: 40,
}

export const driver: Worker = {
  id: 'w-driver',
  wiwId: 'wiw-6',
  name: 'Alex T.',
  role: 'DRIVER',
  type: 'FLOATER',
  homeStoreId: 'store-a',
  clusterId: 'detroit',
  approvedStoreIds: [],
  uphAvg: 0,
}

export const allWorkers = [fixedShopper, floaterShopper, flexShopper, flexShopperNoApproval, shiftLead, driver]

// ─── Shifts ─────────────────────────────────────────────────────
export function makeShift(overrides: Partial<Shift> & { workerId: string; storeId: string }): Shift {
  return {
    id: `shift-${Math.random().toString(36).slice(2, 8)}`,
    wiwShiftId: `wiw-shift-${Math.random().toString(36).slice(2, 8)}`,
    date: '2026-03-20',
    startTime: '08:00',
    endTime: '10:00',
    netHours: 1.5, // 2h - 0.5 buffer
    status: 'SCHEDULED',
    ...overrides,
  }
}

// Pre-built shift: Maria working morning shop window at store-a
export const mariaMorningShift = makeShift({
  workerId: fixedShopper.id,
  storeId: 'store-a',
  startTime: '08:00',
  endTime: '10:00',
  netHours: 1.5,
})

// Driver shift covering morning delivery
export const alexDriverShift = makeShift({
  workerId: driver.id,
  storeId: 'store-a',
  startTime: '10:00',
  endTime: '12:00',
  netHours: 1.5,
})

// ─── Time helpers ───────────────────────────────────────────────
/** Create a Date object for "now" relative to the test window date */
export function nowAt(time: string): Date {
  const [h, m] = time.split(':').map(Number)
  return new Date(2026, 2, 20, h, m) // March 20, 2026
}

export function nowTomorrow(time: string): Date {
  const [h, m] = time.split(':').map(Number)
  return new Date(2026, 2, 19, h, m) // March 19 = tomorrow for March 20 windows
}

export function nowFuture(): Date {
  return new Date(2026, 2, 15, 9, 0) // 5 days before window date
}
