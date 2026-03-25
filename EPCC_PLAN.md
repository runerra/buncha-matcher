# Plan: The Matcher V1

**Created**: 2026-03-19 | **Updated**: 2026-03-19 | **Complexity**: Complex

---

## 1. Product Overview

The Matcher is the supply-side counterpart to The Buncher. Where The Buncher optimizes order-to-window allocation, The Matcher optimizes worker-to-window allocation. Both use the same ops-first pattern: surface recommendations, Ops accepts or declines, system executes.

**V1 is ops-assisted**: the system detects gaps, recommends fills, and the Ops manager accepts or declines every recommendation before action is taken. Twilio fires on approval only.

**Goal**: 0 closed windows per day. 0 rescheduled/cancelled orders caused by staffing gaps.

**Scope boundary**: Metro cluster. Detroit (6 stores), Lansing, Grand Rapids are independent pools. Cross-metro moves are not realistic.

**Development phases**:
| Phase | Behavior |
|-------|----------|
| **V1** | Matcher surfaces recommendations. Ops reviews and approves every action. Twilio fires on approval only. |
| **V2** | Approved action types auto-execute without manual approval. Ops can still override. |
| **V3** | Full cron automation. Matcher fires actions autonomously. Exception-based management. |

V2/V3 unlocked once V1 recommendation accuracy is validated — mirrors The Buncher's arc.

**V1 decisions** (confirmed):
- **WIW integration**: REST API + webhooks. Built behind abstraction. WIW is source of truth for shift data and destination for confirmed writes only.
- **Communication**: Twilio direct SMS — not WIW messaging. Matcher owns full message state machine. WIW only touched on confirmed YES.
- **Order volume**: Lives in Matcher's own PostgreSQL database. Real-time order events trigger gap re-evaluation.
- **UPH history**: In Matcher's DB. New shopper tiers: <7d = 60 UPH, 7-14d = 75, 14+ = 90, then 4-week rolling avg.
- **Accept flow**: Ops approves → Twilio SMS fires → worker replies YES/NO → YES = WIW shift write-back → capacity recalculates.
- **Auth**: No auth for V1 (internal tool).
- **Driver model**: Ops-configurable per store.
- **Window counts**: Configurable per store per day.
- **Alert trigger rule**: Alerts fire on **worker absence/removal only** — not on UPH variation from shopper swaps.

---

## 2. Three-Stage Pipeline

### Stage 1: Gap Detection — "Which windows need attention?"

Scans all upcoming windows and evaluates each against current staffing and capacity.

#### Scan Schedule

| Scan | Time | Purpose |
|------|------|---------|
| Night scan | 5:00 PM ET | Forward-look across next 24–48hrs · pre-loads dashboard |
| Morning scan | Before first shopping window | Primary planning scan · Ops resolves before day begins |
| Hourly scan | Every hour during ops | Ongoing detection as day evolves |

#### Forward-Look Horizon

Aligns with 7-day run scheduler deployment window.

| Horizon | Urgency | Behavior |
|---------|---------|----------|
| T-7 days | Plannable | Window tracked, no recommendation yet |
| T-48 hours | Plannable | Gap flagged on dashboard only |
| T-24 hours | Actionable | Recommendation surfaced · Ops can approve outreach |
| Same day | Urgent | Recommendation surfaced immediately |
| T-5 hours | High urgency | Piggyback on `notifyForPotentialOOS` RabbitMQ event |
| T-30 min before shop start | Critical | Last chance · piggyback on `scheduleRunForShoppingCommunication` |
| Shopping window start | **Hard cutoff** | No further actions · gap logged as unresolved |

#### Alert Trigger Rule

| Cause | Alert fires? |
|-------|-------------|
| Shopper/driver no-show or call-out | Yes — immediately |
| Worker removed from WIW shift | Yes |
| No WIW shifts found for a run | Yes — run set to 0 · flagged in dashboard |
| Lower UPH shopper swapped in | No |
| Flex shift split changes allocation | Silent re-eval · alert only if below capacity threshold |

#### Event-Driven Triggers (outside hourly scan)

| Event | Matcher action |
|-------|---------------|
| Shopper/driver call-out or no-show | Gap live instantly · recommendation surfaced · Ops notified |
| WIW shift missing at 1:30am auto-cap | Run to 0 · flagged for morning review |
| Flex shift accepted and split | Capacity updated · run re-evaluated silently |
| Run hits 100% utilization | Phase 2 incremental capacity check triggered |

### Stage 2: Worker Matching — "Who should fill the gap?"

#### Matching Priority Order (enforced)

1. **Fixed employee at same store** — lowest disruption, check availability first
2. **Floater** — assign to store for the day based on need (one store per day)
3. **Flex employee** — check approved store list and availability window
4. **Shift lead** — coverage of last resort, management role protected where possible
5. **Close window** — only if resources can be redeployed to a higher-demand location

#### Worker Constraints

| Constraint | Rule |
|-----------|------|
| Flex employee store access | Approved stores only |
| Floater assignment | One store per day, assigned by Matcher based on need |
| Fixed employee move | Must be geographically nearby |
| Role matching | Shopper gaps → shoppers · driver gaps → drivers · same urgency for both |
| Shift lead | Can plug gaps but primary role is management — used last |

### Stage 3: Recommendation — "What action should Ops take?"

Every gap produces a named recommendation. Ops sees an action card with accept or decline. Decline requires a reason — mirrors The Buncher pattern.

#### Recommendation Types

| Type | Meaning |
|------|---------|
| **MOVE** | Reassign a fixed employee from their home store to cover the gap |
| **ACTIVATE** | Contact a flex employee via Twilio to pick up the open shift |
| **ASSIGN** | Direct a floater to a specific store for the day |
| **CONSOLIDATE** | Close the understaffed window and move resources to higher-demand location |
| **ESCALATE** | Gap cannot be filled — Ops must intervene directly |

#### Recommendation Rules

- CONSOLIDATE only if redeployed resources generate more order volume elsewhere
- ESCALATE only when all other options are exhausted
- Decline → Matcher re-evaluates and surfaces next best option
- Ops has final say on every action in V1

#### Notification Matrix (by horizon and severity)

| Horizon | 1 worker short | 2+ workers short | Window at risk of closing |
|---------|---------------|------------------|--------------------------|
| T-48hr | Dashboard flag only | Dashboard flag + recommendation | Recommendation + CONSOLIDATE option |
| T-24hr | Recommendation surfaced | Recommendation + suggest flex/floater | Recommendation + CONSOLIDATE option |
| Same day | Recommendation + urgent flag | Urgent recommendation | ESCALATE if unresolved |

---

## 3. Backend Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Next.js App                             │
│  Pages Router │ API Routes │ React 19 + MUI v6 Frontend      │
└─────────────────────┬────────────────────────────────────────┘
                      │
       ┌──────────────┼──────────────────┐
       ▼              ▼                  ▼
 ┌──────────┐  ┌──────────────┐  ┌──────────────┐
 │ Gap       │  │ Matching     │  │ Twilio       │
 │ Engine    │  │ Engine       │  │ Comms        │
 │ (pure fn) │  │ (pure fn)    │  │ State Machine│
 └─────┬─────┘  └──────┬───────┘  └──────┬───────┘
       │                │               │
       ▼                ▼               ▼
 ┌──────────────────────────────────────────────┐
 │              Data Layer                       │
 │  PostgreSQL (Prisma ORM)                     │
 │  Orders · UPH · Shifts · Audit Log          │
 └─────────────────┬────────────────────────────┘
                   │
      ┌────────────┼───────────────┐
      ▼            ▼               ▼
┌──────────┐ ┌──────────────┐ ┌──────────────┐
│ WIW      │ │ Event        │ │ Scheduled    │
│ Adapter  │ │ Triggers     │ │ Scans (cron) │
│ (abstract)│ │ (webhooks)   │ │ (safety net) │
└──────────┘ └──────────────┘ └──────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engines | Pure functions, no side effects | Testable against historical data. Replay past scenarios. |
| Communication | Twilio direct, not WIW messaging | Workers get SMS regardless of WIW app. Matcher owns state machine end-to-end. |
| WIW role | Shift data source + confirmed write destination | Clean, auditable. WIW only touched on YES response. |
| Triggers | Event-driven (call-outs, order changes) + scheduled safety net | Real-time response + no missed gaps. |
| Alert rule | Worker absence/removal only | UPH variation from swaps doesn't trigger alerts. |
| UPH for new shoppers | Tiered: 60/75/90 by tenure, then 4-week rolling | SOP-aligned. Prevents over-estimating new worker capacity. |

---

## 4. Data Model

### Entities

```
MetroCluster
  id              UUID
  name            String          "Detroit", "Lansing", "Grand Rapids"
  timezone        String          "America/Detroit"

ClusterConfig
  id              UUID
  clusterId       FK → MetroCluster
  thresholds      JSON            configurable trigger thresholds
  updatedAt       DateTime

Store
  id              UUID
  name            String
  clusterId       FK → MetroCluster
  address         String
  driverTarget    Int             Ops-configured per store

DeliveryWindow
  id              UUID
  storeId         FK → Store
  date            Date
  startTime       Time            delivery start
  endTime         Time            delivery end
  shopStartTime   Time            shopping start (2hrs before delivery)
  shopEndTime     Time            shopping end
  status          Enum            OPEN | AT_RISK | CLOSED

WindowSnapshot (latest state, updated on every trigger)
  id              UUID
  windowId        FK → DeliveryWindow   UNIQUE
  orderVolume     Int
  shopperSupply   Int             total capacity (units)
  shopperDemand   Int
  shopperGap      Int
  shopperUtilPct  Decimal
  driverSupply    Int
  driverTarget    Int
  driverGap       Int
  thresholdState  Enum            OK | WARNING | CRITICAL | GAP
  lastEvaluatedAt DateTime
  lastTriggeredBy Enum            ORDER_EVENT | SHIFT_EVENT | SCHEDULED_SCAN

Worker
  id              UUID
  wiwId           String
  name            String
  role            Enum            SHOPPER | DRIVER | BOTH
  type            Enum            FIXED | FLOATER | FLEX | SHIFT_LEAD
  homeStoreId     FK → Store
  approvedStores  FK[] → Store    FLEX only
  clusterId       FK → MetroCluster
  uphAvg          Decimal         4-week rolling average
  startDate       Date            for new shopper UPH tiers
  phone           String          for Twilio outreach

Shift (from WIW sync)
  id              UUID
  wiwShiftId      String
  workerId        FK → Worker
  storeId         FK → Store
  date            Date
  startTime       Time
  endTime         Time
  netHours        Decimal         hours minus 0.5hr buffer
  status          Enum            SCHEDULED | CALLED_OUT | REMOVED | NO_SHOW

ActionCard
  id              UUID
  clusterId       FK → MetroCluster
  windowId        FK → DeliveryWindow
  gapType         Enum            SHOPPER_GAP | DRIVER_GAP | BOTH_GAP
  actionType      Enum            MOVE | ACTIVATE | ASSIGN | CONSOLIDATE | ESCALATE
  lane            Enum            NEEDS_ACTION | IN_PROGRESS | RESOLVED | UNRESOLVED
  timeUrgency     Enum            SAME_DAY | T_24HR | T_48HR | T_7D
  description     String          human-readable context
  acceptLabel     String          "Accept — activate flex"
  createdAt       DateTime
  updatedAt       DateTime
  resolvedAt      DateTime?

Recommendation
  id              UUID
  cardId          FK → ActionCard
  windowId        FK → DeliveryWindow
  workerId        FK → Worker
  role            Enum            SHOPPER | DRIVER
  priority        Int
  reason          String
  status          Enum            PENDING | ACCEPTED | DECLINED | EXPIRED

TwilioMessage (comms state machine)
  id              UUID
  cardId          FK → ActionCard
  workerId        FK → Worker
  to              String          worker phone
  body            String          message content
  state           Enum            (see Twilio state machine below)
  sentAt          DateTime?
  respondedAt     DateTime?
  response        String?         YES | NO | raw text

AuditLog
  id              UUID
  timestamp       DateTime
  actorId         String          "SYSTEM" | Ops ID
  action          Enum            RECOMMENDATION_GENERATED | APPROVED | SMS_SENT |
                                  ACCEPTED | DECLINED | CONSOLIDATED | ESCALATED |
                                  SHIFT_WRITE_FAILED | GAP_RESOLVED | GAP_UNRESOLVED |
                                  AUTO_FLAGGED
  cardId          FK → ActionCard
  recommendationId FK?
  declineReason   String?
  metadata        JSON
```

---

## 5. Gap Detection + Capacity Logic

Pure function. Inputs in, evaluation out.

### Capacity Formula (from SOP)

```
workerCapacity = UPH × (shiftHours − 0.5)
capped at 400 units (MAX_DYNAMIC_CAPACITY)
```

### New Shopper UPH Tiers (from SOP)

| Tenure | UPH |
|--------|-----|
| < 7 days | 60 |
| 7–14 days | 75 |
| 14+ days | 90 |
| 4+ weeks | 4-week rolling average |

`effectiveUPH(worker)` checks `worker.startDate` against current date, falls back to rolling avg for tenured workers.

### Operational Constants

| Constant | Value | Source |
|----------|-------|--------|
| Shift time buffer | 30 min (0.5hr) | `SHOP_TIME_REFACTOR_DYNAMIC_CAPACITY` |
| Max run capacity | 400 units | `MAX_DYNAMIC_CAPACITY` |
| UPH rolling window | 4 weeks | SOP |
| Auto-cap script | 1:30 AM ET daily | SOP |
| Hard cutoff | Shopping window start | Operational rule |
| Alert trigger | Worker absence/removal only | Operational rule |

### Urgency Scoring (time-based, from forward-look horizon)

| Time to Window | UI Label | Card Behavior |
|---------------|----------|--------------|
| > 48 hours | T-7d / T-48hr | Dashboard flag only. No recommendation unless 2+ workers short. |
| 24–48 hours | T-48hr | Recommendation surfaced if gap exists |
| < 24 hours | T-24hr | Actionable. Recommendation + Ops can approve outreach. |
| Same day | Same day | Urgent. Recommendation surfaced immediately. |
| < 5 hours | Same day (high) | Piggyback on `notifyForPotentialOOS`. |
| < 30 min | Same day (critical) | Last chance. Piggyback on `scheduleRunForShoppingCommunication`. |
| Window started | — | **Hard cutoff**. No further actions. Gap logged as unresolved. |

---

## 6. Matching Logic

Pure function. Takes a gap + available workers → ranked recommendations with named action type.

### Priority → Action Type Mapping

| Priority | Worker Type | Action Type |
|----------|------------|-------------|
| 1 | Fixed employee (same store) | MOVE (if from another assignment) or ASSIGN |
| 2 | Floater | ASSIGN (to store for the day) |
| 3 | Flex employee | ACTIVATE (Twilio SMS to pick up shift) |
| 4 | Shift lead | ASSIGN (last resort) |
| 5 | No workers | CONSOLIDATE (if resources redeploy to higher-demand) |
| 6 | Nothing viable | ESCALATE |

### Availability Filters

```
Worker is available IF:
  - No conflicting shift
  - hoursScheduledToday + gapShiftHours <= 8
  - If total > 6h → 1hr break must be possible
  - Role matches gap type
  - Same cluster
  - FLEX: gap store in approvedStores
  - FLOATER: not already assigned to a different store today
  - FIXED move: geographically nearby
```

### Consolidation Rule

CONSOLIDATE only recommended if redeployed resources generate more order volume elsewhere. System verifies target window has remaining capacity.

---

## 7. Twilio Communication Architecture

Matcher uses Twilio for all worker outreach. WIW is not in the communication loop.

### Two-Call Pattern

**Call 1 — Outbound SMS**: Matcher composes message → Ops approves → Twilio fires SMS → no WIW involvement

**Call 2 — Inbound Reply**: Worker replies YES/NO → Twilio webhook → server processes:
- YES → WIW API creates shift → capacity recalculates → state = `accepted`
- NO → Matcher re-evaluates → next recommendation surfaced → state = `declined`

### State Machine

| State | Description |
|-------|-------------|
| `recommended` | Matcher surfaced action · awaiting Ops approval |
| `approved` | Ops approved · Twilio queued |
| `sms_sent` | Message delivered to worker |
| `awaiting_response` | No reply yet · visible in dashboard |
| `accepted` | Worker confirmed · run recalculates |
| `declined` | Worker declined · next option surfaces |
| `shift_write_failed` | Worker accepted · WIW API call failed · Ops resolves manually |
| `gap_resolved` | Accepted and WIW updated · or Ops intervened |
| `gap_unresolved` | Shopping window started · logged |

### WIW Write-Back Failure Handling

If WIW shift creation fails after YES:
- Dashboard surfaces `shift_write_failed` state
- Ops notified: confirmation received but WIW not updated
- Ops resolves manually in WIW
- Capacity not updated until WIW write confirmed

---

## 8. UI Layout

### Dashboard Structure

```
┌──────────────────────────────────────────────────────────────────┐
│  The Matcher    [Thu Mar 19 · 8:14 AM]    [V1 · Ops approves]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐ ┌────────────────┐ ┌──────────────┐ ┌───────────┐│
│  │Needs     │ │Awaiting        │ │Resolved      │ │Windows at ││
│  │action    │ │response        │ │today         │ │risk (7d)  ││
│  │    4     │ │      2         │ │      6       │ │     5     ││
│  └──────────┘ └────────────────┘ └──────────────┘ └───────────┘│
│                                                                  │
│  ACTION QUEUE                                                    │
│                                                                  │
│  ┃ [Same day] [Shopper gap] ACTIVATE                            │
│  ┃ Grand River · 12pm–2pm delivery window                       │
│  ┃ Sharkia called out · capacity drops 90 units · 1 short       │
│  ┃ (Accept — activate flex)  (Decline)                          │
│  ┃ SMS to flex pool · Grand River approved stores               │
│                                                                  │
│  ┃ [Same day] [Driver gap] MOVE                                 │
│  ┃ Warren · 2pm–4pm delivery window                             │
│  ┃ No driver scheduled · van unassigned · window at risk        │
│  ┃ (Accept — move Archie from Clinton Twp)  (Decline)           │
│                                                                  │
│  ┃ [T-24hr] [Shopper gap] ASSIGN                                │
│  ┃ Wixom · Fri Mar 20 · 10am–12pm delivery window              │
│  ┃ 1 shopper short · floater Demarko available tomorrow         │
│  ┃ (Accept — assign Demarko)  (Decline)                         │
│                                                                  │
│  ┃ [T-48hr] [Recurring gap] ESCALATE                            │
│  ┃ Waterford · 3 consecutive days understaffed                  │
│  ┃ Shopper gap Mon/Tue/Wed · flex pool exhausted · structural   │
│  ┃ (Accept — escalate to leadership)  (Decline)                 │
│                                                                  │
│  RESOLVED TODAY                                                  │
│  ├ LP · 9am · Sharkia moved from GRD · 6:58 AM      [Resolved] │
│  ├ Clinton Twp · 11am · Flex activated · Frances     [Resolved] │
│  ├ Warren · 9am · Archie reassigned · 7:12 AM        [Resolved] │
│                                                                  │
│  ─────────────────────────────────────────────                   │
│                                                                  │
│  COMMS CENTER                                                    │
│  Pre-populated messages from approved recommendations.           │
│                                                                  │
│  ● To: Grand River flex pool (3 workers)                         │
│    ACTIVATE · 12pm–2pm · pending approval                        │
│    ┌─────────────────────────────────────────┐                   │
│    │ Hi — open shopper shift at Grand River  │                   │
│    │ today 9am–11am. Can you cover? YES/NO   │                   │
│    └─────────────────────────────────────────┘                   │
│    [Send via Twilio]  Approve action card first                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Design Principles

- Single screen. No navigation. Every element serves a decision.
- Action cards: left accent bar (red=same day, green=T-24hr, blue=T-48hr), badges for urgency + gap type + action type.
- Accept buttons describe the specific action ("Accept — activate flex", "Accept — move Archie").
- Decline requires initials and reason (mirrors Buncher).
- Resolved items are compact single-line rows, collapsed by default.
- Comms Center shows pre-populated Twilio messages. Send disabled until card approved.
- Warm, minimal palette. No clutter.

---

## 9. Supply Position View

The Matcher extends the existing supply dashboard with a forward-looking, actionable layer.

### Metrics the Matcher Adds

| Metric | Description |
|--------|-------------|
| Shopper supply vs demand | Scheduled hours vs UPH capacity needed — today + 7 days |
| Driver supply vs demand | Driver availability vs van slots required |
| Role gap frequency | Which role generating most gaps over trailing 7 days |
| Windows at risk | Windows in next 7 days where staffing can't meet demand |
| Flex pool exhaustion | All flex workers spoken for at a cluster |
| Recurring gap pattern | Same gap at same store 3+ consecutive days = structural |

### Supply Position Rules

- Shopper gap frequency > driver → flag **net shopper shortage**, recommend hire/expand flex
- Flex activated 3+ consecutive days at same store → **recurring gap** → convert to fixed headcount
- Flex pool fully utilized at cluster → **flex pool exhausted** → escalate
- Floater coverage > 2 stores/day consistently → **floater pool undersized**
- Supply position calculated per store cluster + network level
- 5pm night scan is primary refresh for supply position

---

## 10. Implementation Plan

4 sessions. Each produces a working, testable increment.

### Session 1: Schema + Engines ✅ DONE

- Prisma schema, domain types, WIW adapter (mock)
- Capacity calculator, window evaluator, cluster evaluator (pure fns + 62 tests)
- Matching engine: availability filter, priority ranker, consolidation finder

### Session 2: API Layer

- REST endpoints: clusters, supply position, windows, cards, config, audit
- Order + WIW webhooks → evaluate → create/update/auto-resolve cards
- Twilio message state machine endpoints
- Scan trigger endpoint

### Session 3: Dashboard UI ✅ IN PROGRESS

- Warm minimal theme (light/dark)
- Summary counters + Action Queue + Resolved rows + Comms Center
- Accept/Decline flow with named action types
- Matches reference design from timing rules doc

### Session 4: Cron + Twilio + E2E

- node-cron (5pm, 1:30am, morning, hourly)
- Twilio two-call pattern (outbound SMS + inbound reply handler)
- Recurring gap detection (3+ consecutive days)
- End-to-end test: gap → recommend → approve → SMS → YES → WIW write → resolved

---

## 11. Risks, Assumptions, Open Questions

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WIW write-back failures | H | `shift_write_failed` state visible in dashboard. Ops resolves manually. Capacity not updated until confirmed. |
| New shopper UPH overestimate | M | Tiered defaults (60/75/90) prevent over-capacity assumptions for new hires. |
| Twilio SMS delivery failures | M | Retry logic. Dashboard shows `sms_sent` vs `awaiting_response` so Ops has visibility. |
| Flex pool exhaustion not caught early | M | Supply position flags exhaustion proactively. Recurring gap detection catches structural issues. |
| Alert noise from non-absence events | L | Alert rule: absence/removal only. UPH swaps are silent re-eval. |

### Assumptions

- WIW REST API supports shift CRUD + webhooks for call-outs (built behind abstraction)
- UPH history and order data available in Matcher's Postgres DB
- Workers have phone numbers for Twilio SMS
- Ops reviews dashboard primarily during morning scan and throughout the day
- Hard cutoff at shopping window start is enforced — no late actions

### Key Principles (from timing rules)

1. Always try to staff — exhaust every option before CONSOLIDATE or ESCALATE
2. Ops has final say — every recommendation can be accepted or declined in V1
3. Alerts on absence, not performance — UPH swaps don't trigger alerts
4. Role integrity — shift leads are last resort
5. Windows stay open — CONSOLIDATE only if redeployed resources generate more volume elsewhere
6. Feel like the Buncher — same action card pattern, same decline-with-reason flow
