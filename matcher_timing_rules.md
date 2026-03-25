# The Matcher — rules, timing, and phasing

A sibling to The Buncher. Where The Buncher optimizes order-to-window allocation, The Matcher optimizes worker-to-window allocation. Both use the same ops-first pattern: surface recommendations, Ops accepts or declines, system executes.

---

## The big picture

Every day, The Matcher looks at all upcoming delivery windows and figures out whether each one has the right workers in the right place. It does this in three stages:

1. **Gap detection** — Identify which windows are understaffed, overstaffed, or at risk
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

The Matcher scans all upcoming windows and evaluates each one against current staffing and capacity.

### Scan schedule

| Scan | Time | Purpose |
|---|---|---|
| Night scan | 5:00 PM ET | Forward-look across all windows for next 24–48hrs · pre-loads Ops dashboard |
| Morning scan | Before first shopping window | Primary planning scan · Ops reviews and resolves before day begins |
| Hourly scan | Every hour during operating hours | Ongoing detection · surfaces new recommendations as day evolves |

### Forward-look horizon

Aligns with the 7-day run scheduler deployment window (`createNextWeekDayRecurringRuns()`).

| Horizon | Urgency | Behavior |
|---|---|---|
| T-7 days | Plannable | Window tracked, no recommendation yet |
| T-48 hours | Plannable | Gap flagged on Ops dashboard only |
| T-24 hours | Actionable | Recommendation surfaced · Ops can approve outreach |
| Same day | Urgent | Recommendation surfaced immediately |
| T-5 hours | High urgency | Piggyback on `notifyForPotentialOOS` RabbitMQ event |
| T-30 min before shopping start | Critical | Piggyback on `scheduleRunForShoppingCommunication` · last chance |
| Shopping window start | **Hard cutoff** | No further actions · gap logged as unresolved |

### Alert trigger rule

Alerts fire on **worker absence or removal only** — not on UPH variation from a shopper swap.

| Cause | Alert fires? |
|---|---|
| Shopper/driver no-show or call-out | Yes — immediately |
| Worker removed from WIW shift | Yes |
| No WIW shifts found for a run | Yes — run set to 0 · flagged in Matcher dashboard |
| Lower UPH shopper swapped in | No |
| Flex shift split changes shopper allocation | Silent re-evaluation · alert only if window drops below capacity threshold |

### Event-driven triggers (outside hourly scan)

| Event | Matcher action |
|---|---|
| Shopper/driver call-out or no-show | Gap live instantly · recommendation surfaced · Ops notified |
| WIW shift missing at 1:30am auto-cap | Run to 0 · flagged for morning review in Matcher dashboard |
| Flex shift accepted and split | Capacity updated · run re-evaluated silently |
| Run hits 100% utilization | Phase 2 incremental capacity check triggered |

---

## Stage 2: Worker matching — "Who should fill the gap?"

Once a gap is detected the Matcher finds the best available worker using a priority order.

### Matching priority order

1. **Fixed employee at same store** — lowest disruption, check availability first
2. **Floater** — assign to store for the day based on need
3. **Flex employee** — check approved store list and availability window
4. **Shift lead** — coverage of last resort, management role protected where possible
5. **Close window** — only if resources can be redeployed to a higher-demand location

### Worker constraints

| Constraint | Rule |
|---|---|
| Flex employee store access | Approved stores only — not all locations |
| Floater assignment | One store per day, assigned by Matcher based on network need |
| Fixed employee move | Must be geographically nearby |
| Role | Shopper gaps filled by shoppers · driver gaps filled by drivers · same urgency level for both |
| Shift lead | Can plug gaps but primary role is management — used last |

---

## Stage 3: Recommendation — "What action should Ops take?"

Every gap produces a named recommendation. Ops sees an action card with accept or decline. Decline requires a reason — mirrors The Buncher pattern.

### Recommendation types

| Recommendation | Meaning |
|---|---|
| **MOVE** | Reassign a fixed employee from their home store to cover the gap |
| **ACTIVATE** | Contact a flex employee via Twilio to pick up the open shift |
| **ASSIGN** | Direct a floater to a specific store for the day |
| **CONSOLIDATE** | Close the understaffed window and move its resources to a higher-demand location |
| **ESCALATE** | Gap cannot be filled by available workers — Ops must intervene directly |

### Recommendation rules

- A window will never be recommended for CONSOLIDATE unless the resources can generate more order volume elsewhere
- ESCALATE is only surfaced when all other options are exhausted
- If Ops declines a recommendation, the Matcher re-evaluates and surfaces the next best option
- Ops has final say on every action in V1

### Notification matrix (by horizon and severity)

| Horizon | 1 worker short | 2+ workers short | Window at risk of closing |
|---|---|---|---|
| T-48hr | Dashboard flag only | Dashboard flag + recommendation | Recommendation + CONSOLIDATE option |
| T-24hr | Recommendation surfaced | Recommendation + suggest flex/floater | Recommendation + CONSOLIDATE option |
| Same day | Recommendation + urgent flag | Urgent recommendation | ESCALATE if unresolved |

---

## The Ops timeline

Mirrors The Buncher's dispatcher view. Windows are organized by urgency:

- **Needs action** — Gaps with recommendations awaiting Ops approval. This is the primary working view.
- **In progress** — Recommendations approved, awaiting worker response via Twilio.
- **Resolved** — Gaps filled. Collapsed by default.
- **Unresolved** — Shopping window started with gap still open. Logged for review.

### Action cards

Each recommendation appears as an action card. Ops can:
- **Accept** — Approve the recommendation. Twilio fires (if applicable) or action executes.
- **Decline** — Override the recommendation. Requires initials and a reason. Matcher re-evaluates.

---

## Twilio communication architecture

The Matcher uses Twilio for all worker outreach. WIW is not in the communication loop — it is only the source of truth for shift data and the destination for confirmed shift writes.

### Two-call pattern

**Call 1 — outbound SMS**
Matcher composes message · Ops approves · Twilio fires SMS directly to worker's phone · no WIW involvement

**Call 2 — inbound reply handler**
Worker replies YES or NO · Twilio webhook posts to pikup-server · server processes response:
- YES → WIW API call to create or assign shift · run capacity recalculates · Matcher state updates to `accepted`
- NO → Matcher re-evaluates next best worker · state updates to `declined` · next recommendation surfaced to Ops

### Why Twilio direct over WIW native messaging
- Workers receive SMS regardless of WIW app activity
- Matcher owns full message state machine end-to-end
- WIW only touched on confirmed YES — clean, auditable write-back
- Not dependent on WIW messaging API reliability or notification delays

### WIW write-back failure handling
If the WIW shift creation call fails after a YES reply (e.g. hours conflict, shift overlap, API error):
- Matcher surfaces a `shift write failed` state in the dashboard
- Ops is notified that confirmation was received but WIW was not updated
- Ops resolves manually in WIW
- Run capacity is not updated until WIW write is confirmed successful

---

## Response state log (Twilio)

Fires only after Ops approves. Live queue visible in Ops dashboard at all times.

| State | Description |
|---|---|
| `recommended` | Matcher surfaced action · awaiting Ops approval |
| `approved` | Ops approved · Twilio queued |
| `sms_sent` | Message delivered to worker |
| `awaiting_response` | No reply yet · visible in dashboard |
| `accepted` | Worker confirmed · run recalculates |
| `declined` | Worker declined · Matcher surfaces next option |
| `shift_write_failed` | Worker accepted · WIW API call failed · Ops must resolve manually |
| `gap_resolved` | Accepted and WIW updated · or Ops intervened |
| `gap_unresolved` | Shopping window started · logged |

> Ops sees all `awaiting_response` items in real time. There is no timeout before escalation — Ops has visibility from the moment the SMS is sent.

---

## Key principles

1. **Always try to staff** — The Matcher exhausts every worker option before recommending CONSOLIDATE or ESCALATE
2. **Ops has final say** — Every recommendation can be accepted or declined in V1
3. **Alerts on absence, not performance** — UPH swaps do not trigger alerts; worker removal does
4. **Role integrity** — Shift leads are last resort; driver and shopper gaps treated with equal urgency
5. **Windows stay open** — CONSOLIDATE only recommended if redeployed resources generate more volume elsewhere
6. **Feel like the Buncher** — Same action card pattern, same decline-with-reason flow, same dispatcher-first philosophy

---

## Supply position view

The Matcher extends the existing supply dashboard (Total Supply, Total Orders, Total Hrs Worked, Total Units, Daily Orders, Units per Employee) with a forward-looking, role-level, and actionable layer. It does not rebuild what already exists — it sits on top of it.

### Existing metrics the Matcher consumes

| Metric | How the Matcher uses it |
|---|---|
| **Total Supply** | Baseline headcount to compare against window demand |
| **Units per Employee** | Network-level realized UPH — compared against scheduled UPH capacity to find productivity gaps |
| **Daily Supply Trend** | Trailing signal for whether supply is growing, stable, or shrinking |
| **Hours per Employee Trend** | Utilization signal — low hours = underutilization, high hours = burnout/attrition risk |
| **New vs Existing Employees** | Leading indicator for workforce stability — declining new employee ratio flags flex pool risk |

### What the Matcher adds

| Metric | Description |
|---|---|
| **Shopper supply vs demand** | Scheduled shopper hours vs UPH capacity needed across all windows — today and next 7 days |
| **Driver supply vs demand** | Scheduled driver availability vs van slots required across all active runs |
| **Role gap frequency** | Which role (shopper vs driver) is generating the most gaps over trailing 7 days |
| **Windows at risk** | Count of windows in the next 7 days where scheduled staffing cannot meet demand |
| **Flex pool exhaustion** | Whether all available flex workers are spoken for at a given store cluster |
| **Recurring gap pattern** | Stores where the same gap appears 3+ consecutive days — structural, not situational |

### Supply position rules

- If shopper gap frequency exceeds driver gap frequency consistently, the Matcher flags a **net shopper shortage** and recommends increasing shopper headcount or flex pool size
- If flex workers are being activated on 3+ consecutive days at the same store, the Matcher flags a **recurring gap pattern** — this is a structural hole, not a one-off absence, and should be converted to fixed headcount
- If the flex pool at a given store cluster is fully utilized (all available flex workers scheduled) with no remaining flex capacity, the Matcher flags **flex pool exhausted** for that cluster and escalates to Ops
- As the flex pool grows, utilization rate becomes a more meaningful signal and this threshold should be revisited — suggested trigger for review when flex exceeds 20% of total workforce
- If floater coverage ratio exceeds 2 stores per floater per day consistently, the Matcher flags **floater pool undersized**
- Supply position is calculated per store cluster (paired consolidated stores share a supply view) and at the network level
- The 5pm ET night scan is the primary refresh for supply position — it reflects the most complete picture of next-day and forward staffing before Ops closes out for the evening

### Recommended actions from supply position

| Signal | Recommendation type |
|---|---|
| Net shopper shortage (7-day trend) | Hire · expand flex pool |
| Net driver shortage (7-day trend) | Hire · review van utilization |
| Recurring gap at same store (3+ days) | Convert to fixed headcount |
| Flex pool exhausted at a cluster | Expand flex pool for that cluster |
| Floater pool undersized | Add floater capacity |
| Specific store chronically understaffed | Review consolidation plan or dedicated hire |

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
| Alert trigger | Worker absence/removal only | Operational rule |
| V1 execution model | Ops approves all actions | Product decision |
