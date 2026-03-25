// Region → store mapping. Store numbers are the most reliable identifier.

export const REGIONS: { id: string; label: string; storeNumbers: string[]; storeMatchers: string[] }[] = [
  {
    id: 'detroit',
    label: 'Detroit',
    storeNumbers: ['72', '53', '286', '243', '208', '122'],
    storeMatchers: ['belleville', 'waterford', 'grand river', 'clinton', 'lincoln park', 'wixom'],
  },
  {
    id: 'lansing',
    label: 'Lansing',
    storeNumbers: ['52', '23'],
    storeMatchers: ['east lansing', '023-meijer lansing', 'meijer lansing'],
  },
  {
    id: 'grand-rapids',
    label: 'Grand Rapids',
    storeNumbers: ['311', '20'],
    storeMatchers: ['alpine', '28th', 'grand rapids'],
  },
]

/** Filter stores by region using store number (from order file) or name matching. */
export function filterStoresByRegion<T extends { storeId?: string; storeName?: string; name?: string }>(
  stores: T[],
  regionId: string,
): T[] {
  const region = REGIONS.find((r) => r.id === regionId)
  if (!region) return stores

  return stores.filter((s) => {
    const name = (s.storeName || s.name || '').toLowerCase()
    const id = s.storeId || ''

    // Check by store number embedded in name (e.g. "286-Meijer Grand River" → "286")
    const numMatch = name.match(/^(\d+)/)
    if (numMatch && region.storeNumbers.includes(numMatch[1])) return true

    // Check by store ID if it contains a store number
    for (const num of region.storeNumbers) {
      if (id.includes(`store-num-${num}`)) return true
    }

    // Fallback: substring matching on name
    return region.storeMatchers.some((m) => name.includes(m))
  })
}
