import * as XLSX from 'xlsx'
import type { Worker, Shift, DeliveryWindow, Store } from '../types'

// ─── Parse result ───────────────────────────────────────────────

export interface WindowOrderData {
  units: number
  maxCapacity: number
  orders: number
  maxOrderCapacity: number
}

export interface ParsedSchedule {
  stores: Store[]
  workers: Worker[]
  shifts: Shift[]
  windows: DeliveryWindow[]
  orderVolumes: Map<string, number>
  windowOrderData: Map<string, WindowOrderData>  // windowId → full order data
  errors: string[]
  _dates?: string[]
  _orderVolumes?: [string, number][]
  _windowOrderData?: [string, WindowOrderData][]
}

// ─── WIW Schedule row (from "Schedules - [store]" sheets) ───────

interface WIWShiftRow {
  Schedule: string
  Site: string
  Position: string
  'Shift Tags': string
  'OpenShift Count': number | null
  'First Name': string
  'Last Name': string
  'Employee ID': string
  Email: string
  'Shift Start Date': string
  'Shift Start Time': string
  'Shift End Time': string
  'Unpaid Break': number
  'Scheduled Hours': number
  'Hourly Rate': number
  'Labor Cost': string
  Status: string
  Notes: string
}

// ─── WIW Employee row (from "Employees" sheet) ──────────────────

interface WIWEmployeeRow {
  'First Name': string
  'Last Name': string
  Email: string
  'Phone Number': number | string
  'Employee ID': string
  Schedules: string
  Positions: string
  Tags: string
  'Base Hourly Rate': number
  'Max Hours': number
  Notes: string
  'WIW User ID (DO NOT MODIFY)': number
}

// ─── Store number → WIW schedule name mapping ──────────────────

const STORE_NUM_TO_NAME: Record<string, string> = {
  '72': '072-meijer belleville',
  '53': '053-meijer waterford',
  '52': '052-meijer east lansing',
  '311': '311-meijer grand rapids',
  '286': '286-meijer grand river',
  '243': '243- meijer clinton twns',
  '208': '208-meijer lincoln park',
  '20': '020-meijer alpine',
  '122': '122-meijer wixom',
  '23': '023-meijer lansing',
  '36': '036-meijer clyde',
}

// ─── Order CSV parser ───────────────────────────────────────────

interface OrderCSVRow {
  runId: string
  storeNum: string
  maxCapacity: number
  orders: number
  units: number
  maxOrderCapacity: number
  deliveryWindow: string
  date: string
  address: string
}

export function parseOrderCSV(text: string): OrderCSVRow[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  return lines.slice(1).map((line) => {
    // Handle CSV with possible quoted fields
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { parts.push(current.trim()); current = ''; continue }
      current += ch
    }
    parts.push(current.trim())
    return {
      runId: parts[0] || '',
      storeNum: parts[1] || '',
      maxCapacity: Number(parts[2]) || 0,
      orders: Number(parts[3]) || 0,
      units: Number(parts[4]) || 0,
      maxOrderCapacity: Number(parts[5]) || 0,
      deliveryWindow: parts[6] || '',
      date: parts[7] || '',
      address: parts[8] || '',
    }
  })
}

/**
 * Apply order CSV data to a ParsedSchedule.
 * The order file is the SOURCE OF TRUTH for delivery windows, units, and capacity.
 * When orders are uploaded, they REPLACE any generated standard windows.
 */
export function applyOrderData(
  parsed: ParsedSchedule,
  orderRows: OrderCSVRow[],
): void {
  // Clear generated windows and volumes — order file is the source of truth
  parsed.windows = []
  parsed.orderVolumes = new Map()
  parsed.windowOrderData = new Map()

  for (const row of orderRows) {
    // Find store by number
    const storeName = STORE_NUM_TO_NAME[row.storeNum]
    if (!storeName) continue
    const store = parsed.stores.find((s) => s.name.toLowerCase().includes(storeName.split('-')[1]?.trim() || '___'))
      || parsed.stores.find((s) => s.name.toLowerCase() === storeName)
    if (!store) continue

    // Parse window times from "10:00 AM – 12:00 PM" or "10:00 AM - 12:00 PM"
    const winMatch = row.deliveryWindow.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)/i)
    if (!winMatch) continue
    const startTime = parseTime(winMatch[1])
    const endTime = parseTime(winMatch[2])
    const date = parseDateFromLong(row.date)

    const winId = `${store.id}-${date}-${startTime}-${endTime}`

    if (!parsed.windows.find((w) => w.id === winId)) {
      const [sh] = startTime.split(':').map(Number)
      const shopStart = `${String(Math.max(0, sh - 2)).padStart(2, '0')}:00`
      parsed.windows.push({
        id: winId,
        storeId: store.id,
        date,
        startTime,
        endTime,
        shopStartTime: shopStart,
        shopEndTime: startTime,
      })
    }

    // Set order volume and full order data
    parsed.orderVolumes.set(winId, row.units)
    parsed.windowOrderData.set(winId, {
      units: row.units,
      maxCapacity: row.maxCapacity,
      orders: row.orders,
      maxOrderCapacity: row.maxOrderCapacity,
    })
  }

  // Collect all unique dates from the order data
  parsed._dates = [...new Set(parsed.windows.map((w) => w.date))].sort()
}

function parseDateFromLong(s: string): string {
  // "Monday, March 23, 2026" → "2026-03-23"
  const match = s.match(/(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!match) return parseDate(s)
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  }
  const m = months[match[1].toLowerCase()] || '01'
  return `${match[3]}-${m}-${match[2].padStart(2, '0')}`
}

// ─── Main parser ────────────────────────────────────────────────

export function parseWIWFiles(
  scheduleBuffer: ArrayBuffer,
  rosterBuffer: ArrayBuffer,
): ParsedSchedule {
  const errors: string[] = []
  const scheduleWb = XLSX.read(scheduleBuffer, { type: 'array' })
  const rosterWb = XLSX.read(rosterBuffer, { type: 'array' })

  // 1. Parse employees
  const empSheet = rosterWb.Sheets['Employees']
  if (!empSheet) {
    errors.push('Employees sheet not found in roster file')
    return { stores: [], workers: [], shifts: [], windows: [], orderVolumes: new Map(), windowOrderData: new Map(), errors }
  }
  const empRows = XLSX.utils.sheet_to_json<WIWEmployeeRow>(empSheet, { defval: '' })

  // 2. Discover stores from schedule sheet names
  const storeMap = new Map<string, Store>()
  const scheduleSheets: { sheetName: string; storeName: string }[] = []

  for (const name of scheduleWb.SheetNames) {
    if (!name.startsWith('Schedules - ')) continue
    // Extract store name from the sheet, read from first data row
    const rows = XLSX.utils.sheet_to_json<WIWShiftRow>(scheduleWb.Sheets[name], { defval: '' })
    if (rows.length === 0) continue
    const storeName = rows[0].Schedule || name.replace('Schedules - ', '')
    const storeKey = storeName.toLowerCase()
    if (!storeMap.has(storeKey)) {
      storeMap.set(storeKey, {
        id: `store-${storeMap.size}`,
        name: storeName,
        clusterId: guessCluster(storeName),
        driverTarget: 1,
      })
    }
    scheduleSheets.push({ sheetName: name, storeName: storeKey })
  }

  const stores = Array.from(storeMap.values())

  // 3. Build workers from employee roster
  const workerMap = new Map<string, Worker>()
  for (const emp of empRows) {
    const name = `${emp['First Name']} ${emp['Last Name']}`.trim()
    if (!name || name === 'OpenShift') continue

    const email = String(emp.Email || '').toLowerCase()
    const key = email || name.toLowerCase()
    if (workerMap.has(key)) continue

    const positions = String(emp.Positions || '').split(',').map((p) => p.trim().toLowerCase())
    const role = parseRole(positions)
    const type = parseType(positions)
    const schedules = String(emp.Schedules || '').split(',').map((s) => s.trim())
    const homeStore = findStore(schedules[0] || '', storeMap)

    // Map all scheduled stores to store IDs — this is the approved store list
    const approvedStoreIds: string[] = []
    for (const sched of schedules) {
      const store = findStore(sched, storeMap)
      if (store) approvedStoreIds.push(store.id)
    }

    workerMap.set(key, {
      id: `w-${workerMap.size}`,
      wiwId: String(emp['WIW User ID (DO NOT MODIFY)'] || ''),
      name,
      role,
      type,
      homeStoreId: homeStore?.id || '',
      clusterId: homeStore?.clusterId || 'detroit',
      approvedStoreIds,
      uphAvg: 60, // default — would come from historical data
    })
  }

  const workers = Array.from(workerMap.values())

  // 4. Parse shifts from all schedule sheets
  const shifts: Shift[] = []
  const dateSet = new Set<string>()

  for (const { sheetName, storeName } of scheduleSheets) {
    const rows = XLSX.utils.sheet_to_json<WIWShiftRow>(scheduleWb.Sheets[sheetName], { defval: '' })
    const store = storeMap.get(storeName)
    if (!store) continue

    for (const row of rows) {
      const firstName = String(row['First Name'] || '').trim()
      if (!firstName || firstName === 'OpenShift') continue

      const fullName = `${firstName} ${row['Last Name'] || ''}`.trim()
      const email = String(row.Email || '').toLowerCase()
      const worker = workerMap.get(email) || workerMap.get(fullName.toLowerCase())

      if (!worker) {
        errors.push(`Shift: unknown worker "${fullName}" at ${store.name}`)
        continue
      }

      const date = parseDate(row['Shift Start Date'])
      const startTime = parseTime(row['Shift Start Time'])
      const endTime = parseTime(row['Shift End Time'])
      const hours = Number(row['Scheduled Hours']) || 0
      const status = parseStatus(row.Status)

      dateSet.add(date)

      shifts.push({
        id: `shift-${shifts.length}`,
        workerId: worker.id,
        storeId: store.id,
        date,
        startTime,
        endTime,
        netHours: Math.max(0, hours - (Number(row['Unpaid Break']) || 0)),
        status,
      })
    }
  }

  // 5. Generate delivery windows (standard 2hr slots 10am-8pm) for each store × date
  const windowMap = new Map<string, DeliveryWindow>()
  const orderVolumes = new Map<string, number>()
  const slots: [string, string][] = [
    ['10:00', '12:00'], ['12:00', '14:00'], ['14:00', '16:00'],
    ['16:00', '18:00'], ['18:00', '20:00'],
  ]

  for (const store of stores) {
    for (const date of dateSet) {
      for (const [start, end] of slots) {
        const winId = `${store.id}-${date}-${start}`
        const [sh] = start.split(':').map(Number)
        const shopStart = `${String(sh - 2).padStart(2, '0')}:00`
        windowMap.set(winId, {
          id: winId,
          storeId: store.id,
          date,
          startTime: start,
          endTime: end,
          shopStartTime: shopStart,
          shopEndTime: start,
        })
        orderVolumes.set(winId, 200) // default demand — no order data in WIW export
      }
    }
  }

  return {
    stores,
    workers,
    shifts,
    windows: Array.from(windowMap.values()),
    orderVolumes,
    windowOrderData: new Map(),
    errors,
  }
}

/** Legacy single-file parser for the template format */
export function parseScheduleFile(buffer: ArrayBuffer): ParsedSchedule {
  const wb = XLSX.read(buffer, { type: 'array' })

  // Detect WIW multi-sheet format
  const hasScheduleSheets = wb.SheetNames.some((n) => n.startsWith('Schedules - '))
  if (hasScheduleSheets) {
    // WIW schedule file uploaded alone — parse without roster
    return parseWIWScheduleOnly(wb)
  }

  // Template format (Shifts, Workers, Orders sheets)
  return parseTemplateFormat(wb)
}

function parseWIWScheduleOnly(wb: XLSX.WorkBook): ParsedSchedule {
  const errors: string[] = []
  const storeMap = new Map<string, Store>()
  const workerMap = new Map<string, Worker>()
  const shifts: Shift[] = []
  const dateSet = new Set<string>()

  for (const name of wb.SheetNames) {
    if (!name.startsWith('Schedules - ')) continue
    const rows = XLSX.utils.sheet_to_json<WIWShiftRow>(wb.Sheets[name], { defval: '' })
    if (rows.length === 0) continue

    const storeName = rows[0].Schedule || name.replace('Schedules - ', '')
    const storeKey = storeName.toLowerCase()
    if (!storeMap.has(storeKey)) {
      storeMap.set(storeKey, {
        id: `store-${storeMap.size}`,
        name: storeName,
        clusterId: guessCluster(storeName),
        driverTarget: 1,
      })
    }
    const store = storeMap.get(storeKey)!

    for (const row of rows) {
      const firstName = String(row['First Name'] || '').trim()
      if (!firstName || firstName === 'OpenShift') continue

      const fullName = `${firstName} ${row['Last Name'] || ''}`.trim()
      const email = String(row.Email || '').toLowerCase()
      const key = email || fullName.toLowerCase()

      if (!workerMap.has(key)) {
        const pos = String(row.Position || '').toLowerCase()
        workerMap.set(key, {
          id: `w-${workerMap.size}`,
          wiwId: '',
          name: fullName,
          role: pos.includes('driver') ? 'DRIVER' : pos === 'flex' ? 'BOTH' : 'SHOPPER',
          type: pos === 'flex' ? 'FLEX' : pos.includes('lead') ? 'SHIFT_LEAD' : 'FIXED',
          homeStoreId: store.id,
          clusterId: store.clusterId,
          approvedStoreIds: [],
          uphAvg: 60,
        })
      }

      const worker = workerMap.get(key)!
      const date = parseDate(row['Shift Start Date'])
      dateSet.add(date)

      shifts.push({
        id: `shift-${shifts.length}`,
        workerId: worker.id,
        storeId: store.id,
        date,
        startTime: parseTime(row['Shift Start Time']),
        endTime: parseTime(row['Shift End Time']),
        netHours: Math.max(0, (Number(row['Scheduled Hours']) || 0) - (Number(row['Unpaid Break']) || 0)),
        status: parseStatus(row.Status),
      })
    }
  }

  const stores = Array.from(storeMap.values())
  const workers = Array.from(workerMap.values())

  // Generate windows
  const windowMap = new Map<string, DeliveryWindow>()
  const orderVolumes = new Map<string, number>()
  const slots: [string, string][] = [
    ['10:00', '12:00'], ['12:00', '14:00'], ['14:00', '16:00'],
    ['16:00', '18:00'], ['18:00', '20:00'],
  ]
  for (const store of stores) {
    for (const date of dateSet) {
      for (const [start, end] of slots) {
        const winId = `${store.id}-${date}-${start}`
        const [sh] = start.split(':').map(Number)
        windowMap.set(winId, {
          id: winId, storeId: store.id, date,
          startTime: start, endTime: end,
          shopStartTime: `${String(sh - 2).padStart(2, '0')}:00`, shopEndTime: start,
        })
        orderVolumes.set(winId, 200)
      }
    }
  }

  return {
    stores, workers, shifts,
    windows: Array.from(windowMap.values()),
    orderVolumes, windowOrderData: new Map(), errors,
  }
}

function parseTemplateFormat(wb: XLSX.WorkBook): ParsedSchedule {
  // Original template parser — kept for backwards compat
  const errors: string[] = []
  const storeSet = new Set<string>()

  interface ShiftRow { worker_id: string; worker_name: string; store: string; date: string; start_time: string; end_time: string; role: string; status: string }
  interface WorkerRow { worker_id: string; name: string; role: string; type: string; home_store: string; approved_stores: string; uph: number }
  interface OrderRow { store: string; date: string; window_start: string; window_end: string; order_units: number }

  const shiftRows = readSheet<ShiftRow>(wb, 'Shifts', errors)
  const workerRows = readSheet<WorkerRow>(wb, 'Workers', errors)
  const orderRows = readSheet<OrderRow>(wb, 'Orders', errors)

  for (const r of shiftRows) storeSet.add(norm(r.store))
  for (const r of workerRows) storeSet.add(norm(r.home_store))
  for (const r of orderRows) storeSet.add(norm(r.store))

  const storeMap = new Map<string, Store>()
  let idx = 0
  for (const name of storeSet) {
    if (!name) continue
    storeMap.set(name, { id: `store-${idx++}`, name, clusterId: 'detroit', driverTarget: 1 })
  }

  const wMap = new Map<string, Worker>()
  for (const r of workerRows) {
    const hs = storeMap.get(norm(r.home_store))
    if (!hs) continue
    const approved = (r.approved_stores || '').split(',').map((s) => storeMap.get(norm(s))?.id).filter(Boolean) as string[]
    const id = r.worker_id || `w-${wMap.size}`
    wMap.set(id, {
      id, wiwId: id, name: r.name,
      role: r.role?.toLowerCase().includes('driver') ? 'DRIVER' : r.role?.toLowerCase() === 'both' ? 'BOTH' : 'SHOPPER',
      type: r.type?.toLowerCase() === 'flex' ? 'FLEX' : r.type?.toLowerCase() === 'floater' ? 'FLOATER' : r.type?.toLowerCase().includes('lead') ? 'SHIFT_LEAD' : 'FIXED',
      homeStoreId: hs.id, clusterId: 'detroit', approvedStoreIds: approved, uphAvg: Number(r.uph) || 60,
    })
  }

  const windowMap = new Map<string, DeliveryWindow>()
  const orderVolumes = new Map<string, number>()
  for (const r of orderRows) {
    const store = storeMap.get(norm(r.store))
    if (!store) continue
    const date = parseDate(r.date)
    const start = parseTime(r.window_start)
    const end = parseTime(r.window_end)
    const winId = `${store.id}-${date}-${start}`
    if (!windowMap.has(winId)) {
      const [sh] = start.split(':').map(Number)
      windowMap.set(winId, {
        id: winId, storeId: store.id, date, startTime: start, endTime: end,
        shopStartTime: `${String(sh - 2).padStart(2, '0')}:00`, shopEndTime: start,
      })
    }
    orderVolumes.set(winId, Number(r.order_units) || 0)
  }

  const shifts: Shift[] = []
  for (const r of shiftRows) {
    const store = storeMap.get(norm(r.store))
    if (!store) continue
    let worker = wMap.get(r.worker_id)
    if (!worker) worker = Array.from(wMap.values()).find((w) => w.name.toLowerCase() === r.worker_name?.toLowerCase())
    if (!worker) continue
    const date = parseDate(r.date)
    const start = parseTime(r.start_time)
    const end = parseTime(r.end_time)
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    shifts.push({
      id: `shift-${shifts.length}`, workerId: worker.id, storeId: store.id, date,
      startTime: start, endTime: end,
      netHours: Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60 - 0.5),
      status: parseStatus(r.status),
    })
  }

  return { stores: Array.from(storeMap.values()), workers: Array.from(wMap.values()), shifts, windows: Array.from(windowMap.values()), orderVolumes, windowOrderData: new Map(), errors }
}

// ─── Helpers ────────────────────────────────────────────────────

function readSheet<T>(wb: XLSX.WorkBook, name: string, errors: string[]): T[] {
  const s = wb.Sheets[name]
  if (!s) { errors.push(`Sheet "${name}" not found`); return [] }
  return XLSX.utils.sheet_to_json<T>(s, { defval: '' })
}

function norm(s: string): string { return (s || '').trim().toLowerCase() }

function parseRole(positions: string[]): Worker['role'] {
  const hasShopper = positions.some((p) => p.includes('shopper'))
  const hasDriver = positions.some((p) => p.includes('driver'))
  if (hasShopper && hasDriver) return 'BOTH'
  if (hasDriver) return 'DRIVER'
  return 'SHOPPER'
}

function parseType(positions: string[]): Worker['type'] {
  if (positions.some((p) => p === 'flex')) return 'FLEX'
  if (positions.some((p) => p.includes('lead'))) return 'SHIFT_LEAD'
  return 'FIXED'
}

function parseStatus(s: string): Shift['status'] {
  const v = (s || '').toLowerCase()
  if (v.includes('unpublish')) return 'REMOVED'
  return 'SCHEDULED'
}

function parseDate(s: string): string {
  if (!s) return new Date().toISOString().split('T')[0]
  const str = String(s)
  if (str.includes('-') && str.length >= 10) return str.slice(0, 10)
  const parts = str.split('/')
  if (parts.length === 3) {
    const [m, d, y] = parts
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (!isNaN(Number(s))) {
    const date = new Date((Number(s) - 25569) * 86400000)
    return date.toISOString().split('T')[0]
  }
  return str.split('T')[0]
}

function parseTime(s: string): string {
  if (!s) return '10:00'
  const str = String(s).trim()
  const ampm = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i)
  if (ampm) {
    let h = parseInt(ampm[1])
    const m = ampm[2]
    if (ampm[3].toLowerCase() === 'pm' && h !== 12) h += 12
    if (ampm[3].toLowerCase() === 'am' && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }
  if (str.includes(':')) return str.slice(0, 5).padStart(5, '0')
  return '10:00'
}

function findStore(scheduleName: string, storeMap: Map<string, Store>): Store | undefined {
  const key = scheduleName.toLowerCase()
  for (const [k, v] of storeMap) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return undefined
}

function guessCluster(storeName: string): string {
  const n = storeName.toLowerCase()
  if (n.includes('east lansing') || (n.includes('lansing') && !n.includes('east'))) return 'lansing'
  if (n.includes('grand rapids') || n.includes('alpine') || n.includes('28th') || n.includes('kalamazoo')) return 'grand-rapids'
  if (n.includes('clinton') || n.includes('belleville') || n.includes('lincoln')
    || n.includes('grand river') || n.includes('wixom') || n.includes('waterford')) return 'detroit'
  // Dispatchers, Minneapolis, Clyde, etc. — won't match any region filter
  return 'other'
}
