import type { Shift } from '../types'

/**
 * Abstract interface for When I Work integration.
 * Real implementation wired in when API access is available.
 */
export interface WIWAdapter {
  /** Fetch all shifts for a store on a date */
  fetchShifts(storeId: string, date: string): Promise<Shift[]>

  /** Create a new shift in WIW (on accept) */
  createShift(params: CreateShiftParams): Promise<{ wiwShiftId: string }>

  /** Update an existing shift */
  updateShift(wiwShiftId: string, params: Partial<CreateShiftParams>): Promise<void>

  /** Remove a shift */
  removeShift(wiwShiftId: string): Promise<void>
}

export interface CreateShiftParams {
  workerId: string
  storeId: string
  date: string
  startTime: string
  endTime: string
}

/**
 * Mock adapter for development. Returns canned data, logs write operations.
 */
export class MockWIWAdapter implements WIWAdapter {
  private shifts: Shift[] = []

  constructor(initialShifts: Shift[] = []) {
    this.shifts = [...initialShifts]
  }

  async fetchShifts(storeId: string, date: string): Promise<Shift[]> {
    return this.shifts.filter((s) => s.storeId === storeId && s.date === date)
  }

  async createShift(params: CreateShiftParams): Promise<{ wiwShiftId: string }> {
    const wiwShiftId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const [startH, startM] = params.startTime.split(':').map(Number)
    const [endH, endM] = params.endTime.split(':').map(Number)
    const hours = (endH * 60 + endM - startH * 60 - startM) / 60

    this.shifts.push({
      id: wiwShiftId,
      workerId: params.workerId,
      storeId: params.storeId,
      date: params.date,
      startTime: params.startTime,
      endTime: params.endTime,
      netHours: Math.max(0, hours - 0.5),
      status: 'SCHEDULED',
    })

    return { wiwShiftId }
  }

  async updateShift(_wiwShiftId: string, _params: Partial<CreateShiftParams>): Promise<void> {
    // no-op for mock
  }

  async removeShift(wiwShiftId: string): Promise<void> {
    this.shifts = this.shifts.filter((s) => s.id !== wiwShiftId)
  }
}
