# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## GET /api/capacity

- Weekday-only hours: the seed only makes sense that way — Ana's Mon–Sun 8h/day
  assignment lands exactly on her 40h capacity when weekends don't count.
- JSON shape: weeks array + per-person allocations map keyed by week start, so
  the grid gets O(1) cell lookup and capacity stays a person-level value.
- Capped ranges at 366 days to bound payload size.
- DB access via sqlx (SelectContext into capacityRow); main.go's server.db is
  now *sqlx.DB over the pgx stdlib driver.

## PATCH /api/people/{id}

- weeklyHours validated to [0, 168]; *float64 so a missing field is distinct
  from an explicit 0 (Eli really has 0 hours).
- Returns the updated person; the grid patches local state from it instead of
  refetching the whole range.
- Tests restore Ana to 40h afterwards so the seed stays pristine.
- Update via sqlx GetContext (RETURNING row scanned into personResponse;
  sql.ErrNoRows → 404).

## CapacityGrid render (TanStack)

- Data via @tanstack/react-query v5 useQuery (queryKey ['capacity', from, to]);
  loading/error states from query state.
- Grid via @tanstack/react-table v9: useTable + tableFeatures({}), columns
  built from the response's weeks; virtualized rows via @tanstack/react-virtual
  v3 (sticky header, absolute-positioned rows, measureElement).
- Cells show "allocated / capacity"; over-allocation is allocated > capacity
  (strictly — 40/40 is exactly full, not over) with a rose-tinted td.over
  (--color-danger); zero capacity (Eli) renders "20 / 0" and flags over.
- Toggl-inspired palette in :root: deep purple bg, surface cards, peach text,
  pink reserved for CTAs; over-allocation uses rose so pink stays exclusive.
- Tests mock @tanstack/react-virtual to render all rows (jsdom has no layout).

## Editing from the grid (TanStack Query)

- useMutation PATCHes /api/people/{id}; onSuccess patches the capacity cache
  via queryClient.setQueryData — no refetch. Exactly consistent because
  allocations don't depend on weeklyHours; only the derived over/under
  display changes. A test pins this: /api/capacity is fetched exactly once.
- Editor: click "40h/wk" in the name cell → inline number input; Enter/Save or
  Esc/Cancel; client validates 0–168 before sending; pink Save button (the
  palette's one CTA), neutral Cancel.

## Virtualized grid bug found by human: single massive row

- Symptom: one huge row rendered, rest "buried deep" in the scroll area.
- Root cause: virtual rows were in normal flow inside tbody{display:grid;
  height:totalSize}. CSS grid align-content:stretch distributes the free space
  across the few rendered rows, stretching each to ~800px; measureElement then
  cached the poisoned heights, compounding it.
- Fix: position:absolute on tbody rows (scoped to tbody so the sticky header
  row stays in flow) + translateY from the virtualizer. Rows no longer
  participate in grid layout, so no stretch and real heights are measured.
