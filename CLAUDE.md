# CLAUDE.md — The Matcher

Staffing coverage tool for Buncha delivery operations. Helps Ops managers keep all
delivery windows open by surfacing staffing gaps early enough to prevent rescheduled
or cancelled orders.

Sibling product to "The Buncher" (order → window allocation). The Matcher handles
the supply side: worker → window allocation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15, React 19 (pages router) |
| UI | Material-UI (MUI) v6, Emotion |
| Language | TypeScript 5 |
| State | React Context (local state for V1) |

---

## Development Commands

```bash
npm run dev           # Start dev server
npm run build         # Production build
npm run start         # Start production server
npm run lint          # Lint
```

---

## Project Structure

```
src/
  pages/              # Next.js routes (thin wrappers — no logic here)
  modules/
    matcher/          # Primary feature module
      components/     # UI components
      screens/        # Page-level screen components
      types/          # TypeScript types
      data/           # Mock data (V1)
      hooks/          # Custom hooks
      utils/          # Pure utility functions
      context/        # React context providers
      theme/          # Theme tokens + ThemeContext
```

---

## Domain Context

### What is Buncha?
Grocery delivery service operating across 9 stores in Michigan.

### Key Concepts
- **Delivery Window**: 2-hour customer-facing time slot (e.g., 12–2pm delivery)
- **Shopper**: Works 2 hours BEFORE the delivery window (shopping 10am–12pm for 12–2pm delivery)
- **Driver**: Works DURING the delivery window (driving 12–2pm for 12–2pm delivery)
- **Unit Capacity**: Each worker can process 80–120 items per window
- **Window Target**: 300 units of shopper capacity + exactly 1 driver per window
- **Covered Window**: Shopper capacity ≥ target AND 1 driver assigned
- **Stores**: 9 locations, each with 5 or 10 delivery windows per day

### Break Policy (Michigan Labor Law)
- 1-hour mandatory break after 6+ hours scheduled
- 8-hour daily max (net hours after break deduction)

### The Matcher's Job
Surface coverage gaps across stores and time horizons so Ops managers can:
1. See which windows are at risk (today, this week, next week)
2. Identify which workers are available to fill gaps
3. Take action before gaps become cancelled orders

---

## Design Guidelines
- Linear-inspired aesthetic (clean, muted, professional)
- Token-based theming with light/dark mode support
- No unnecessary abbreviations (spell out "units", not "u")
- Always-editable fields (no edit mode toggles)
- Concise UI — no visual clutter
