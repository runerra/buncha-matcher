# The Matcher — Rules, Timing, and Phasing (V2)

> **V2 updates**: This document supersedes the original `matcher_timing_rules.md` with refinements based on V1 implementation and operational feedback. Changes from V1 are called out in [Change Log](#change-log-v1--v2) at the bottom.

A sibling to The Buncher. Where The Buncher optimizes order-to-window allocation, The Matcher optimizes worker-to-window allocation. Both use the same ops-first pattern: surface recommendations, Ops accepts or declines, system executes.

---

## The big picture

Every day, The Matcher looks at all upcoming delivery windows and figures out whether each one has the right workers in the right place. It does this in three stages:

1. **Gap detection** — Identify which windows are understaffed, at risk, or missing driver coverage
2. **Worker matching** — Find the best available worker to fill each gap
3. **Recommendation** — Surface a named action for Ops to accept or decline

---

## Development phases

| Phase | Behavior |
|---|---|
| **V1** | Matcher surfaces recommendations. Ops reviews and approves every action. Twilio fires on approval only. |
| **V2** | Recommendations still surface. Approved action types auto-execute without manual approval. Ops can still override. |
| **V3** | Full cron automation. Matcher fires actions autonomously on schedule. Ops receives notifications, not approval requests. Exception-based management. |

> V2 and V3 are unlocked once V1 recommendation accuracy is validated in the field — mirrors The Buncher's development arc.

---

## Stage 1: Gap detection — "Which windows need attention?"

The Matcher evaluates each delivery window against the order file data (source of truth for capacity) and WIW shift data.

### Window health states

| State | Condition | Action |
|---|---|---|
| **Covered** | Supply covers demand with ≥ 22 units headroom. Driver assigned. | No action needed |
| **Full** | Supply covers demand but orders = max order capacity. All existing orders can be fulfilled but window can't accept more. | Displayed in health grid as green with "FULL" label. No action card. |
| **At Risk** | Supply covers current demand but < 22 units headroom remaining. Existing orders are safe. | Displayed in health grid as yellow. No action card. |
| **Gap** | Demand exceeds supply (units > max capacity) OR no driver assigned OR max capacity < 22 (no meaningful shopper coverage) | Action card generated. Requires Ops decision. |

### Capacity source of truth

The order file's `Max Unit Capacity` is the source of truth for shopper supply. This value is set by the **autocapacity feature** — not by the engine or the Buncher. The engine does not recalculate capacity from UPH × shift hours.

### Real-time gap detection

> **Note**: The current prototype uses file uploads for shift/order data. When passed to the dev team, The Matcher will connect directly to the database for real-time data flow. Recommendations will surface immediately as orders are placed and shifts are claimed/removed in WIW.

### Event-driven triggers (target architecture)

| Event | Matcher action |
|---|---|
| Order placed for a delivery window | Re-evaluate window health · surface recommendation if gap exists and candidates available |
| Order cancelled | Re-evaluate · auto-resolve card if gap no longer exists |
| Shift claimed in WIW | Update supply · re-evaluate affected windows |
| Shift removed from WIW | Gap live instantly · recommendation surfaced · Ops notified |
| WIW shift missing at 1:30am auto-cap | Run to 0 · flagged for morning review in Matcher dashboard |
| Flex shift accepted and split | Capacity updated · run re-evaluated silently |

### Alert and notification timing

Orders arrive at earliest T-3 days before delivery. The Matcher surfaces recommendations as early as possible and escalates urgency as the window approaches. The principle: **recommend early, escalate late.**

| Timing | What happens | Urgency |
|---|---|---|
| **T-3 days (orders arrive)** | Matcher evaluates. If gap exists AND candidates available → surface recommendation immediately. If gap but no candidates → dashboard flag only. | LOW |
| **T-24 hours** | Any unacted gaps bump urgency. Recommendation surfaced if not already. | MEDIUM |
| **Same day (morning)** | All unresolved gaps bump urgency. Ops gets summary: "X gaps still need action today." | HIGH |
| **T-5 hours** | Unresolved cards auto-bump to CRITICAL. | CRITICAL |
| **T-30 min before shop start** | Final notification. If still unresolved → auto-ESCALATE to leadership. | CRITICAL (auto-escalate) |
| **Shopping window start** | **Hard cutoff.** No further actions. Card → Unresolved. Logged. | — |

**Key rules:**
- Recommendations surface the **moment** a gap is detected with available candidates — not gated behind time horizons
- Only **urgency** changes with time proximity, not whether the recommendation is shown
- If Ops hasn't acted and the window is approaching, urgency auto-increases through the tiers
- Auto-escalation at T-30min is the only automated action — everything else requires Ops approval in V1

### Urgency auto-progression

A card's urgency progresses automatically based on time remaining:

```
LOW (T-3 days) → MEDIUM (T-24hr) → HIGH (same day morning) → CRITICAL (T-5hr) → AUTO-ESCALATE (T-30min) → UNRESOLVED (window start)
```

Ops can resolve the card at any point in this progression. If they act early (at LOW), the urgency never increases. If they don't act, the system escalates on their behalf at T-30min.

### SMS timing

When Ops clicks Accept on a card with a worker requiring outreach (ACTIVATE for Flex):
- **SMS fires immediately** — no batching, no delay
- Whether the window is T-3 days or same-day, the worker gets the message the moment Ops approves
- Earlier outreach = more time for worker to respond = higher confirmation rate

### Dual coverage requirement

A delivery window requires BOTH shopper coverage AND driver coverage to operate. A window missing either generates separate action cards for each need.

### Alert trigger rule

Alerts fire on **shift removal only** — not on UPH variation from a shopper swap.

| Cause | Alert fires? |
|---|---|
| Shift removed from WIW | Yes — gap detected immediately |
| No WIW shifts found for a run | Yes — run set to 0 · flagged in Matcher dashboard |
| Lower UPH shopper swapped in | No |
| Flex shift split changes shopper allocation | Silent re-evaluation · alert only if window drops below capacity threshold |

---

## Stage 2: Worker matching — "Who should fill the gap?"

Once a gap is detected the Matcher finds the best available worker using a priority order that prioritizes workers already on the schedule over those requiring outreach.

### Filter stage (sequential — first rejection wins)

Every worker in the system is evaluated against these filters in order. The first filter to reject a worker excludes them with a specific reason.

| Order | Filter | Exclusion reason |
|---|---|---|
| 1 | **Store eligibility** — Is the gap store in the worker's WIW Schedules list? | "Not eligible for this store" |
| 2 | **Region/cluster** — Is the worker in the same metro cluster as the gap store? | "Different region" |
| 3 | **Role match** — Does the worker's role (Shopper/Driver/Both) match the gap type? | "Role mismatch" |
| 4 | **FT scheduled today** — If Fixed type, do they have any shifts today? | "Fixed worker not scheduled today" |
| 5 | **Already covering window** — Does the worker have a shift that fully covers this window's shopping period at this store? | "Already scheduled for this window (capacity counted)" |
| 6 | **Schedule conflict** — Does any of the worker's shifts overlap with this window? | "Schedule conflict with this window" |
| 7 | **Daily hours max** — Would adding ~2h push the worker over 8h for the day? | "Daily hours maxed" |
| 8 | **Break policy** — Would total exceed 6h without a 1hr break gap between shifts? | "Break policy" |

### Shift-to-window mapping

A worker's shift supports a delivery window only if the shift **fully covers** the shopping period (2 hours before delivery start). No partial coverage.

- Shift 7am–9am fully covers the 9am–11am delivery window (shopping 7–9am) ✓
- Shift 7am–9am does NOT cover the 10am–12pm delivery window (shopping 8–10am, shift ends at 9) ✗

Workers whose shifts already cover a window have their capacity baked into the order file's `Max Unit Capacity`. Recommending them again would double-count.

### Matching priority order

Workers who pass all filters are ranked by priority. The key principle: **workers already on the schedule rank above workers who need outreach**.

| Priority | Worker type | Action type | Rationale |
|---|---|---|---|
| 1 | **Floater** | ASSIGN | Designed to move between stores. Already on the schedule. Known availability. Lowest friction. |
| 2 | **Shift Lead** | ASSIGN | Already on-site at the store. Can plug gaps immediately. No outreach needed. |
| 3 | **Flex employee** | ACTIVATE | Eligible for the store but needs Twilio SMS outreach. Confirmation delay before availability is confirmed. |
| 4 | **Fixed employee (same store)** | ASSIGN | Scheduled today at this store. Available for windows they don't already cover. |
| 5 | **Fixed employee (neighboring store)** | MOVE | Scheduled today at another store. Gap store must be in their WIW Schedules. |
| — | **Consolidate** | CONSOLIDATE | No workers available. Suggest closing window and redeploying resources to higher-demand location. |
| — | **Escalate** | ESCALATE | No workers and consolidation not viable. Ops must intervene directly. |

### Tiebreaking within same priority

1. Fewest hours scheduled today (spread the load)
2. Highest UPH (fill gap with fewer workers — shoppers only)

### Worker constraints

| Constraint | Rule |
|---|---|
| Store eligibility | Worker must have gap store in their WIW Schedules list |
| Role matching | Shopper gaps filled by shoppers · driver gaps filled by drivers · same urgency for both |
| Fixed not scheduled | Excluded entirely. Not on the schedule = can't confirm availability. |
| Fixed already at different store | Excluded. If already working at a different store today, can't move again (one move per day). |
| Shift Lead | Can plug gaps. Primary role is management but ranks above Flex because they're already on-site. |

### Post-accept cascade

When Ops accepts a recommendation:

1. The accepted worker is tracked as assigned to that window
2. All other cards re-evaluate: if the worker appears in their candidate list, availability is re-checked
3. If the worker now conflicts (schedule overlap, hours maxed), they're removed and the next candidate is promoted
4. If no candidates remain after removal, the card downgrades to ESCALATE
5. The accept button on other cards updates in real-time to reflect the new best candidate

---

## Stage 3: Recommendation — "What action should Ops take?"

Every gap produces a named recommendation. Ops sees an action card with accept or decline.

### Recommendation types

| Recommendation | Meaning |
|---|---|
| **ASSIGN** | Direct a floater, shift lead, or same-store fixed employee to cover the gap window |
| **ACTIVATE** | Contact a flex employee via Twilio to pick up the open shift |
| **MOVE** | Reassign a fixed employee from a neighboring store to cover the gap |
| **CONSOLIDATE** | Close the understaffed window and move its resources to a higher-demand location |
| **ESCALATE** | Gap cannot be filled by available workers — Ops must intervene directly |

### Recommendation rules

- A window will never be recommended for CONSOLIDATE unless the resources can generate more order volume elsewhere
- ESCALATE is only surfaced when all other options are exhausted
- If Ops declines a recommendation, the Matcher re-evaluates and surfaces the next best option
- Ops has final say on every action in V1
- A window with both shopper and driver gaps generates **separate cards** for each need

### Issue types

Each action card is categorized by why the gap exists:

| Issue type | Trigger |
|---|---|
| **Understaffed** | Not enough scheduled capacity to cover demand |
| **Driver missing** | No driver assigned to the delivery window |

Structural patterns (recurring gaps, flex pool exhaustion) are tracked separately from per-card issue types.

### Accept flow

Ops clicks Accept on an action card:
1. Card moves to Resolved
2. If worker-based (ASSIGN/ACTIVATE/MOVE): Twilio message is composed and queued
3. Window health grid updates to reflect the change
4. Other cards cascade (accepted worker removed from candidates)
5. Activity log records the action with impact (capacity added, window reopened)

### Decline flow

> **🚧 Not yet built** — needs implementation:
> - Decline button opens a form requiring initials and a reason
> - Decline reasons: predefined list + free text option
> - Matcher re-evaluates and surfaces the next best candidate
> - Decline action logged with reason, timestamp, and actor
> - All decline logs stored and accessible via Activity Log

---

## The Ops timeline

Mirrors The Buncher's dispatcher view. Windows are organized by urgency:

- **Needs action** — Gaps with recommendations awaiting Ops approval. This is the primary working view.
- **In progress** — Recommendations approved, awaiting worker response via Twilio.
- **Resolved** — Gaps filled. Collapsed by default.
- **Unresolved** — Shopping window started with gap still open. Logged for review.

### Action cards

Each recommendation appears as an action card. Ops can:
- **Accept** — Approve the recommendation. Twilio fires (if applicable) or action executes. Accepted worker removed from other cards' candidate lists.
- **Decline** — Override the recommendation. Requires initials and a reason (🚧 not yet built). Matcher re-evaluates.

### Priority scoring

Action cards are ranked by a composite priority score:

**Score = (Time Weight × 50%) + (Severity Weight × 30%) + (Revenue Weight × 20%)**

| Factor | Weight | Values |
|---|---|---|
| Time to window | 50% | Same day = 100, T-24hr = 60, T-48hr = 30, T-3d = 10 |
| Severity | 30% | Window closing (0 supply) = 100, GAP (demand > supply) = 80, CRITICAL (driver missing) = 50 |
| Revenue at risk | 20% | Normalized: units / max units across all cards × 100 |

Tiebreak: highest unit count first, then earliest window start time.

Cards are color-coded by urgency tier (auto-progresses as window approaches):
- **Critical** (red accent): score ≥ 80 or auto-escalated
- **High** (orange accent): score 50–79
- **Medium** (blue accent): score 30–49
- **Low** (gray accent): score < 30

---

## Twilio communication architecture

The Matcher uses Twilio for all worker outreach. WIW is not in the communication loop — it is only the source of truth for shift data and the destination for confirmed shift writes.

### Worker notification patterns

Not all workers are notified the same way. The notification type depends on the action and whether the change requires the worker's confirmation.

| Worker type | Action | SMS type | Confirmation? | Example message |
|---|---|---|---|---|
| **Floater** | ASSIGN | Informational | No | "Hi [name] — you've been assigned to cover shopping at [store] for the [window] delivery window." |
| **Shift Lead** | ASSIGN | Informational | No | "Hi [name] — you've been assigned to cover shopping at [store] for the [window] delivery window." |
| **FT same store** | ASSIGN | Informational | No | "Hi [name] — you've been assigned to cover the [window] delivery window at [store]." |
| **Flex** | ACTIVATE | Confirmation | Yes (YES/NO) | "Hi [name] — can you cover a shift at [store] for the [window] delivery window? Reply YES to confirm or NO to decline." |
| **FT neighboring store** | MOVE | Confirmation | Yes (YES/NO) | "Hi [name] — can you cover a shift at [store] for the [window] delivery window? Reply YES to confirm or NO to decline." |

**Why the difference:**
- **Informational (no confirmation)**: Floaters, Shift Leads, and FT same store workers are already on schedule at the store (or designed to move). The assignment is an operational decision by Ops — the worker just needs to know what they're covering. No confirmation delay.
- **Confirmation required**: Flex workers and FT workers being moved to a different store are being asked to do something outside their current schedule. They need to accept or decline. This introduces a confirmation delay, which is why these worker types rank lower in priority.

### SMS timing

SMS fires **immediately** when Ops clicks Accept — no batching, no delay. Whether the window is T-3 days or same-day, the worker gets the message the moment Ops approves. Earlier outreach = more time to respond = higher confirmation rate.

### Confirmation flow (Flex and MOVE)

**Outbound SMS** — Matcher composes message · Ops approves · Twilio fires SMS directly to worker's phone · no WIW involvement

**Inbound reply handler** — Worker replies YES or NO · Twilio webhook posts to pikup-server · server processes response:
- YES → WIW API call to create or assign shift · run capacity recalculates · Matcher state updates to `accepted`
- NO → Matcher re-evaluates next best worker · state updates to `declined` · next recommendation surfaced to Ops
- No reply → Card stays in `awaiting_response` state · visible to Ops in dashboard · Ops can re-send or choose a different worker

### Informational flow (ASSIGN)

**Outbound SMS only** — Ops approves · Twilio sends informational SMS · WIW shift created immediately (no confirmation wait) · Matcher state updates to `accepted`

No inbound reply expected. The shift is created in WIW as soon as Ops approves.

### Why Twilio direct over WIW native messaging
- Workers receive SMS regardless of WIW app activity
- Matcher owns full message state machine end-to-end
- WIW only touched on confirmed assignment — clean, auditable write-back
- Not dependent on WIW messaging API reliability or notification delays

### WIW write-back failure handling
If the WIW shift creation call fails after approval or YES reply (e.g. hours conflict, shift overlap, API error):
- Matcher surfaces a `shift write failed` state in the dashboard
- Ops is notified that the action was approved but WIW was not updated
- Ops resolves manually in WIW
- Run capacity is not updated until WIW write is confirmed successful

---

## Response state log

Fires only after Ops approves. Live queue visible in Ops dashboard at all times.

### Confirmation flow (Flex / MOVE)

| State | Description |
|---|---|
| `recommended` | Matcher surfaced action · awaiting Ops approval |
| `approved` | Ops approved · Twilio SMS queued |
| `sms_sent` | Confirmation SMS delivered to worker |
| `awaiting_response` | No reply yet · visible in dashboard |
| `accepted` | Worker replied YES · WIW shift created · run recalculates |
| `declined` | Worker replied NO · Matcher surfaces next candidate |
| `shift_write_failed` | Worker accepted · WIW API call failed · Ops must resolve manually |
| `gap_resolved` | WIW updated successfully · or Ops intervened |
| `gap_unresolved` | Shopping window started with gap still open · logged |

### Informational flow (ASSIGN — Floater / Shift Lead / FT same store)

| State | Description |
|---|---|
| `recommended` | Matcher surfaced action · awaiting Ops approval |
| `approved` | Ops approved · WIW shift created immediately · informational SMS sent |
| `sms_sent` | Informational SMS delivered to worker (no reply expected) |
| `shift_write_failed` | Ops approved · WIW API call failed · Ops must resolve manually |
| `gap_resolved` | WIW updated successfully |
| `gap_unresolved` | Shopping window started with gap still open · logged |

> Ops sees all `awaiting_response` items (confirmation flow only) in real time. There is no automatic timeout — Ops has visibility from the moment the SMS is sent and can choose to re-send or pick a different worker.

---

## Key principles

1. **Always try to staff** — The Matcher exhausts every worker option before recommending CONSOLIDATE or ESCALATE
2. **Ops has final say** — Every recommendation can be accepted or declined in V1
3. **Alerts on shift removal, not performance** — UPH swaps do not trigger alerts; shift removal does
4. **Role integrity** — Driver and shopper gaps treated with equal urgency; both needed for a window to operate
5. **Windows stay open** — CONSOLIDATE only recommended if redeployed resources generate more volume elsewhere
6. **Feel like the Buncher** — Same action card pattern, same decline-with-reason flow, same dispatcher-first philosophy
7. **On-schedule first** — Workers already on the WIW schedule rank above workers needing outreach
8. **One move per day** — Fixed employees should not be asked to bounce between multiple stores (does not apply to Floaters)
9. **No double-counting** — Workers whose shifts already cover a window are excluded from recommendations for that window
10. **Order file is source of truth** — Max Unit Capacity from the autocapacity feature determines supply, not engine UPH calculations

---

## Store regions

Metro cluster is the decision unit. Cross-metro moves are not realistic.

| Region | Stores |
|---|---|
| **Detroit** | Clinton Township, Belleville, Lincoln Park, Grand River, Wixom, Waterford |
| **Lansing** | East Lansing |
| **Grand Rapids** | Alpine, 28th St, Kalamazoo |

---

## Operational constants

| Constant | Value | Source |
|---|---|---|
| Shift time buffer | 30 min | `SHOP_TIME_REFACTOR_DYANMIC_CAPACITY` |
| Max run capacity | 400 units | `MAX_DYNAMIC_CAPACITY` |
| New shopper UPH (<7 days) | 60 | SOP default |
| New shopper UPH (7–14 days) | 75 | SOP default |
| New shopper UPH (14+ days) | 90 | SOP default |
| UPH rolling window | 4 weeks | SOP |
| Auto-cap script run time | 1:30 AM ET daily | SOP |
| Hard staffing cutoff | Shopping window start | Operational rule |
| Shopper capacity formula | UPH × (shift hrs − 0.5hr buffer) | SOP |
| Run scheduler look-ahead | 7 days | `createNextWeekDayRecurringRuns()` |
| Driver urgency vs shopper | Same | Operational rule |
| Alert trigger | Shift removal only | Operational rule |
| V1 execution model | Ops approves all actions | Product decision |
| Window open threshold | maxCapacity − units ≥ 22 | Operational rule |
| Shift-to-window coverage | Full coverage only (no partial) | V2 refinement |
| FT move limit | 1 move per day (does not apply to Floaters) | V2 refinement |

---

## Not yet built

The following features are referenced in the design but have not been implemented:

| Feature | Status | Notes |
|---|---|---|
| **Decline with reason flow** | ✅ Built | Popover form with initials + reason (4 predefined options + free text). Decline logged to Activity Log with issue type, action type, worker, reason, and actor. Log filtered by date and region. Re-evaluation on decline deferred — card is dismissed on decline. |
| **Supply position view** | 🚧 Needs build | Shopper/driver supply vs demand, flex pool exhaustion, recurring gap detection |
| **Real-time DB connection** | 🚧 Needs dev team | Replace file uploads with live DB queries for orders and shifts |
| **Twilio integration** | 🚧 Needs build | Two-call pattern, inbound reply handler, WIW write-back |
| **Urgency auto-progression** | 🚧 Needs build | Auto-bump urgency as window approaches (LOW → MEDIUM → HIGH → CRITICAL → AUTO-ESCALATE at T-30min) |
| **Ops morning summary** | 🚧 Needs build | "X gaps still need action today" notification on same-day morning |
| **Auto-escalation at T-30min** | 🚧 Needs build | Automatically escalate unresolved cards to leadership 30min before shop start |
| **Hard cutoff logging** | 🚧 Needs build | Auto-move cards to Unresolved when shopping window starts |
| **Consolidation logic** | 🚧 Needs build | Verify target window has capacity before suggesting |
| **Recurring gap detection** | 🚧 Needs build | Flag same-store gaps appearing 3+ consecutive days |

---

## Change log: V1 → V2

### Priority order overhaul

**V1 (original doc)**:
1. Fixed employee at same store
2. Floater
3. Flex employee
4. Shift lead
5. Close window

**V2 (current)**:
1. Floater
2. Shift Lead
3. Flex
4. FT same store
5. FT neighboring store
6. Consolidate / Escalate

**Why it changed**:

| Change | Reason |
|---|---|
| **Fixed same store dropped from #1 to #4** | If scheduled, their capacity is already counted in Max Unit Capacity for windows they cover. They're only useful for windows they don't already support. If not scheduled today, they're excluded entirely — no way to confirm availability without outreach. |
| **Floater promoted to #1** | Floaters exist specifically to move between stores. They're on the schedule, availability is known, lowest friction to fill a gap. |
| **Shift Lead promoted from #4 to #2** | They're already on-site at the store. No outreach needed, no schedule uncertainty. Can plug gaps immediately. Management duties are secondary when a window is about to close. |
| **FT neighboring store added as #5** | Original doc said "must be geographically nearby." V2 uses the WIW Schedules list as the definition of eligibility — more precise than geography. |

### New filter: FT not scheduled today

**V1**: Not addressed — assumed Fixed workers are always available.
**V2**: Fixed workers with no shifts today are excluded entirely.
**Why**: Can't confirm availability without outreach. If they're not on the WIW schedule for the day, recommending them is unreliable. The schedule is the source of truth for who is working.

### New filter: Already covering this window

**V1**: Not addressed — assumed any available worker can be recommended for any window.
**V2**: Workers whose shift fully covers a window's shopping period at the same store are excluded from recommendations for that window.
**Why**: The order file's Max Unit Capacity (set by autocapacity) already includes their contribution. Recommending them again would double-count capacity and not actually add any.

### Shift-to-window mapping: full coverage only

**V1**: Not specified.
**V2**: A shift supports a window only if it fully contains the shopping period (shift start ≤ shop start AND shift end ≥ shop end). No partial overlap credit.
**Why**: Buncha doesn't do partial coverage. A shopper either covers the full shopping window or they don't.

### One move per day rule (Fixed employees only)

**V1**: "Fixed employee move: must be geographically nearby."
**V2**: Fixed employees can only move to one other store per day. If already working at a different store today, they're excluded. This rule does **not** apply to Floaters — Floaters are designed to move.
**Why**: Asking fixed workers to bounce between multiple stores in the same day is operationally unrealistic and disruptive.

### Capacity source of truth

**V1**: Engine calculates supply from UPH × shift hours.
**V2**: Order file's Max Unit Capacity (set by autocapacity feature) is the source of truth.
**Why**: Autocapacity already computed actual capacity per window accounting for all scheduled workers. The engine's UPH × hours calculation disagreed with the order file and caused false positives.

### Dual coverage cards

**V1**: One card per gap window.
**V2**: Separate cards for shopper need and driver need when a window is missing both.
**Why**: A delivery window requires both shopper AND driver coverage to operate. One card can't solve both needs — they require different worker types and different actions.

### Gap vs At Risk distinction

**V1**: Percentage-based thresholds (75% warning, 90% critical) triggered action cards.
**V2**: Only true gaps (demand > supply) generate action cards. Windows that are near capacity but can still fulfill existing orders are "At Risk" — no action card needed.
**Why**: A window with 116/135 units can fulfill all its orders. Flagging it as a gap created noise and false recommendations. The threshold should be: can we deliver what's been ordered?

### Issue type simplification

**V1**: Call-out, Understaffed, Driver missing.
**V2**: Understaffed, Driver missing only.
**Why**: Call-out detection requires integration with a system that doesn't exist yet. In practice, call-outs are handled by the team removing the shift in WIW, which triggers the gap detection via shift removal. The call-out is the cause; the shift removal is the event the Matcher sees.

### Post-accept cascade

**V1**: Not addressed — accepting a card was independent of other cards.
**V2**: Accepting a card with a worker removes that worker from candidates on other cards. Other cards re-rank automatically.
**Why**: If Archie is assigned to Grand River 9am–11am, he may no longer be available for Grand River 6pm–8pm. The system needs to reflect reality as Ops makes decisions.

### Alert timing overhaul

**V1**: Time-gated recommendations — T-48hr flag only, T-24hr first recommendation, scan schedule drives timing.
**V2**: Recommendations surface immediately when a gap is detected with available candidates. Only urgency changes over time (LOW → MEDIUM → HIGH → CRITICAL → AUTO-ESCALATE). Auto-escalation to leadership at T-30min before shop start if unresolved.
**Why**: Gating recommendations behind time horizons wastes lead time. The earlier Ops acts, the more options they have. Floaters can be pre-positioned, Flex workers are more likely to accept with advance notice. With orders arriving at T-3 days, there's no reason to wait until T-24hr to recommend.

### SMS timing

**V1**: Not specified (implied batching or scheduled sends).
**V2**: SMS fires immediately on Ops accept — no batching, no delay, regardless of whether the window is T-3 days or same-day.
**Why**: Earlier outreach = more time for worker to respond = higher confirmation rate.

### Real-time architecture (planned)

**V1**: Scheduled scans (5pm, 1:30am, morning, hourly).
**V2**: Scan schedule deprecated. Target architecture is event-driven — real-time DB connection triggers re-evaluation on every order placed and every shift change.
**Why**: Scheduled scans miss events between scan intervals. Real-time detection surfaces gaps the moment they occur.
