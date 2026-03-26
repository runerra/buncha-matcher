# Plan: Decline with Reason Flow

**Created**: 2026-03-26 | **Effort**: ~1.5h | **Complexity**: Simple

## 1. Objective

**Goal**: Replace the silent-dismiss Decline button with a form that captures who declined and why, then logs the enriched entry to the Activity Log.

**Why**: Ops currently declines cards with no accountability or audit trail. The V2 spec requires initials + reason for every decline, creating a paper trail for operational review.

**Success criteria**:
1. Decline button opens a popover with initials field + reason selector (predefined list + free text)
2. On submit, card is dismissed and decline is logged with actor initials, reason, declined worker, and timestamp
3. All decline entries visible in Activity Log with reason and initials
4. "Other" reason enables a free text input field

## 2. Approach

**Pattern**: Extend existing Accept flow structure. The current `handleDecline` (Dashboard.tsx:367-387) dismisses the card and writes a bare audit entry. We enrich the audit entry and add a popover form before dismissal.

**Key design decisions**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Decline UI | Popover anchored to Decline button | Lightweight, keeps card context visible, matches Linear aesthetic |
| Card behavior on decline | Dismissed (same as current) | Card should be removed, not re-evaluated with next candidate |
| Reason storage | Extend existing `AuditEntry` with `declineReason`, `declineInitials`, `declinedWorker` | Reuses audit infrastructure, no new state needed |
| Predefined reasons | 4 options (see below) | Based on real Ops scenarios |

**Predefined decline reasons**:
1. "Worker unavailable"
2. "Schedule conflict"
3. "Store not on worker's roster"
4. "Other" (enables free text input)

## 3. Tasks

1. **Extend AuditEntry + build DeclineForm popover** — Add optional fields to AuditEntry, create MUI Popover with initials, reason radio group, conditional free text, Submit/Cancel
2. **Wire up** — Update `handleDecline` signature, integrate popover into ActionCard, render decline details in Activity Log

**Total**: ~1.5h

## 4. Quality Strategy

**Validation**:
- Initials field: required, 2-4 characters
- Reason: required selection
- Free text: required when "Other" is selected, optional otherwise

**Edge cases**:
- Submit disabled until initials + reason are filled
- Popover closes on Cancel without side effects
- Popover closes on submit after successful decline
- Free text field only visible when "Other" selected

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Popover positioning on small screens | L | MUI Popover handles repositioning; test on narrow viewports |
| Audit log rendering cluttered with extra fields | L | Keep decline details compact, secondary text style |

**Assumptions**:
- Decline reasons are static (no need for backend/config-driven list in V1)
- No Twilio notification on decline
- No re-evaluation or candidate promotion — card is simply removed

**Out of scope**: Decline analytics/reporting, auto-timeout for unacted cards, re-evaluation with next candidate
