import * as XLSX from 'xlsx'

/**
 * Generate a sample .xlsx template with the expected sheet structure.
 * Call this from browser: generateTemplate() → triggers download.
 */
export function generateTemplate() {
  const wb = XLSX.utils.book_new()

  // Shifts sheet
  const shifts = [
    { worker_id: 'W001', worker_name: 'Maria Johnson', store: 'Grand River', date: '03/23/2026', start_time: '8:00 AM', end_time: '10:00 AM', role: 'shopper', status: 'scheduled' },
    { worker_id: 'W001', worker_name: 'Maria Johnson', store: 'Grand River', date: '03/23/2026', start_time: '10:00 AM', end_time: '12:00 PM', role: 'shopper', status: 'scheduled' },
    { worker_id: 'W002', worker_name: 'Sam Kim', store: 'Grand River', date: '03/23/2026', start_time: '8:00 AM', end_time: '12:00 PM', role: 'shopper', status: 'called_out' },
    { worker_id: 'W003', worker_name: 'Alex Torres', store: 'Grand River', date: '03/23/2026', start_time: '10:00 AM', end_time: '12:00 PM', role: 'driver', status: 'scheduled' },
    { worker_id: 'W004', worker_name: 'Demarko Williams', store: 'Warren', date: '03/23/2026', start_time: '8:00 AM', end_time: '10:00 AM', role: 'shopper', status: 'scheduled' },
    { worker_id: 'W005', worker_name: 'Keisha Moore', store: 'Warren', date: '03/23/2026', start_time: '10:00 AM', end_time: '14:00', role: 'shopper', status: 'scheduled' },
    { worker_id: 'W006', worker_name: 'Archie Bell', store: 'Clinton Twp', date: '03/23/2026', start_time: '10:00 AM', end_time: '12:00 PM', role: 'driver', status: 'scheduled' },
    { worker_id: 'W007', worker_name: 'Frances Lee', store: 'Warren', date: '03/23/2026', start_time: '12:00 PM', end_time: '14:00', role: 'driver', status: 'scheduled' },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shifts), 'Shifts')

  // Workers sheet
  const workers = [
    { worker_id: 'W001', name: 'Maria Johnson', role: 'shopper', type: 'fixed', home_store: 'Grand River', approved_stores: '', uph: 52, start_date: '01/01/2025', phone: '+13135551001' },
    { worker_id: 'W002', name: 'Sam Kim', role: 'shopper', type: 'floater', home_store: 'Grand River', approved_stores: '', uph: 48, start_date: '06/15/2025', phone: '+13135551002' },
    { worker_id: 'W003', name: 'Alex Torres', role: 'driver', type: 'floater', home_store: 'Grand River', approved_stores: '', uph: 0, start_date: '03/01/2025', phone: '+13135551003' },
    { worker_id: 'W004', name: 'Demarko Williams', role: 'shopper', type: 'floater', home_store: 'Warren', approved_stores: '', uph: 55, start_date: '09/01/2025', phone: '+13135551004' },
    { worker_id: 'W005', name: 'Keisha Moore', role: 'shopper', type: 'flex', home_store: 'Warren', approved_stores: 'Warren, Grand River, Clinton Twp', uph: 45, start_date: '11/01/2025', phone: '+13135551005' },
    { worker_id: 'W006', name: 'Archie Bell', role: 'driver', type: 'floater', home_store: 'Clinton Twp', approved_stores: '', uph: 0, start_date: '02/15/2025', phone: '+13135551006' },
    { worker_id: 'W007', name: 'Frances Lee', role: 'driver', type: 'fixed', home_store: 'Warren', approved_stores: '', uph: 0, start_date: '04/01/2025', phone: '+13135551007' },
    { worker_id: 'W008', name: 'Jordan Lewis', role: 'shopper', type: 'flex', home_store: 'Clinton Twp', approved_stores: 'Clinton Twp, Grand River', uph: 42, start_date: '01/10/2026', phone: '+13135551008' },
    { worker_id: 'W009', name: 'Pat Monroe', role: 'both', type: 'shift_lead', home_store: 'Grand River', approved_stores: '', uph: 40, start_date: '01/01/2024', phone: '+13135551009' },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workers), 'Workers')

  // Orders sheet
  const orders = [
    { store: 'Grand River', date: '03/23/2026', window_start: '10:00', window_end: '12:00', order_units: 200 },
    { store: 'Grand River', date: '03/23/2026', window_start: '12:00', window_end: '14:00', order_units: 280 },
    { store: 'Grand River', date: '03/23/2026', window_start: '14:00', window_end: '16:00', order_units: 150 },
    { store: 'Grand River', date: '03/23/2026', window_start: '16:00', window_end: '18:00', order_units: 120 },
    { store: 'Warren', date: '03/23/2026', window_start: '10:00', window_end: '12:00', order_units: 180 },
    { store: 'Warren', date: '03/23/2026', window_start: '12:00', window_end: '14:00', order_units: 250 },
    { store: 'Warren', date: '03/23/2026', window_start: '14:00', window_end: '16:00', order_units: 200 },
    { store: 'Clinton Twp', date: '03/23/2026', window_start: '10:00', window_end: '12:00', order_units: 160 },
    { store: 'Clinton Twp', date: '03/23/2026', window_start: '12:00', window_end: '14:00', order_units: 190 },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orders), 'Orders')

  XLSX.writeFile(wb, 'matcher-schedule-template.xlsx')
}
