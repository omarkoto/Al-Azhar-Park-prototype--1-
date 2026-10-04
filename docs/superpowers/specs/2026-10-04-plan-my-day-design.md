# Plan My Day — design

Interactive `/plan` page: visitors choose date, party, arrival, duration and mood; the site builds a timed route
through the park, drawn live on a stylised map inside a gold-bordered arch window, anchored on sunset at the
Citadel view. One tap adds the matching tickets to the cart and the whole plan to Google/Apple Calendar.

## Units
- `lib/plan/stops.ts` — stop data (map coords, minutes, moods, bilingual text, photo, restaurant slug).
- `lib/plan/sun.ts` — sunset for Cairo from a date (NOAA sunrise equation), returned as Cairo-local minutes.
- `lib/plan/generate.ts` — pure `generatePlan(input)` → ordered, timed stops. No React.
- `lib/plan/copy.ts` — en/ar UI strings for the page.
- `components/plan/ArchMap.tsx` — SVG map, animated route, markers.
- `pages/Plan.tsx` — controls, live plan, timeline, actions (reuses cart + AddToCalendar).
- `lib/calendar.ts` — `cairoIso()` builds ISO times with the correct Cairo DST offset.

## Rules
- Plan regenerates live on every control change; route animation replays when the stops change.
- Children present → Children's Play Area becomes eligible; otherwise excluded.
- Arrival "golden hour": Hill-top is forced last and timed to sunset − 30 min.
- Tickets: resident/visitor toggle + date → weekday/weekend price via existing `ticketCatalog`.
- Out of scope: live crowd data, accounts, saved/shared plans.
