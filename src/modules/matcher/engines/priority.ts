/**
 * Priority scoring for action cards.
 * Score = (Time Weight × 50) + (Severity Weight × 30) + (Revenue Weight × 20)
 * Higher score = more urgent = higher in queue.
 */

export interface PriorityInput {
  timeToWindow: 'same_day' | 't_24hr' | 't_48hr' | 't_7d'
  thresholdState: string   // 'GAP' | 'CRITICAL' | 'WARNING' | 'OK'
  units: number            // order units at risk in this window
  orders: number           // order count
  maxOrderCapacity: number // max orders the window can hold
  shopperSupply: number    // current supply
  shopperDemand: number    // current demand
}

export interface PriorityResult {
  score: number           // 0-100 composite
  timeScore: number
  severityScore: number
  revenueScore: number
  label: 'Critical' | 'High' | 'Medium' | 'Low'
}

const TIME_WEIGHTS: Record<string, number> = {
  same_day: 100,
  t_24hr: 60,
  t_48hr: 30,
  t_7d: 10,
}

function severityWeight(input: PriorityInput): number {
  // Window closing: no supply or orders maxed out
  if (input.shopperSupply === 0 || input.orders >= input.maxOrderCapacity) return 100
  // GAP: demand exceeds supply
  if (input.thresholdState === 'GAP') return 80
  // CRITICAL: near capacity
  if (input.thresholdState === 'CRITICAL') return 50
  // WARNING
  if (input.thresholdState === 'WARNING') return 20
  return 0
}

/**
 * Calculate priority score for a single card.
 * `maxUnitsAcrossCards` is the highest unit count among all cards in the current view,
 * used to normalize the revenue component.
 */
export function calculatePriority(
  input: PriorityInput,
  maxUnitsAcrossCards: number,
): PriorityResult {
  const timeScore = TIME_WEIGHTS[input.timeToWindow] ?? 10
  const sevScore = severityWeight(input)
  const revenueScore = maxUnitsAcrossCards > 0
    ? Math.round((input.units / maxUnitsAcrossCards) * 100)
    : 0

  const score = Math.round(
    (timeScore * 0.5) + (sevScore * 0.3) + (revenueScore * 0.2),
  )

  const label: PriorityResult['label'] =
    score >= 80 ? 'Critical'
    : score >= 50 ? 'High'
    : score >= 30 ? 'Medium'
    : 'Low'

  return { score, timeScore, severityScore: sevScore, revenueScore, label }
}

/**
 * Sort recommendations by priority score descending.
 * Tiebreak: highest units first, then earliest window time.
 */
export function sortByPriority<T extends { priority?: PriorityResult; units?: number; windowTime?: string }>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => {
    const aScore = a.priority?.score ?? 0
    const bScore = b.priority?.score ?? 0
    if (aScore !== bScore) return bScore - aScore
    // Tiebreak 1: highest units
    const aUnits = a.units ?? 0
    const bUnits = b.units ?? 0
    if (aUnits !== bUnits) return bUnits - aUnits
    // Tiebreak 2: earliest window
    return (a.windowTime ?? '').localeCompare(b.windowTime ?? '')
  })
}
