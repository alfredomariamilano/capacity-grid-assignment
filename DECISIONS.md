# Decisions

Yours to write, not your AI's. Short is good: bullets are fine, and half a page is plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

-
* **Week and hours model:** ISO weeks start Monday, and `hours_per_day` counts Monday through Friday only. This interpretation is required to make the seed data work; Ana's Monday to Sunday 8h/day assignment lands on her 40h capacity, whereas counting weekends yields 56/40. I verified this against the live database before building.
* **JSON shape:** Undefined in the spec. I chose `{weeks: string[], people: [{id, name, weeklyHours, allocations: {weekStart: hours}}]}` for O(1) cell lookups and because capacity is tied to a person rather than a week.
* **Post-save sync:** After a `PATCH`, the grid updates its TanStack Query cache directly from the response (`setQueryData`) without refetching. This works reliably because allocations do not alter `weeklyHours`, only the over/under derivation. A test ensures `/api/capacity` is fetched only once.
* **Validation:** `weeklyHours` is required and bounded between 0 and 168. A `*float64` distinguishes missing values from an explicit zero, which is valid since Eli has zero capacity.
* **Range cap:** `to - from` must be 366 days or fewer, returning a 400 otherwise as a light payload guard.
* **People ordering:** Sorted by `ORDER BY name, id`. I rejected sorting by "over-allocated first" because rows would shift during editing.
* **Zero capacity handling:** Over-allocation is evaluated purely as `allocated > capacity`. Avoiding division lets Eli's "20 / 0" render and flag correctly.
* **Palette:** Pink (`--color-primary-pink`) is reserved for the Save CTA, so over-allocation uses an added rose token (`--color-danger`).
* **Stack:** `sqlx` handles database access, while TanStack Query, Table, and Virtual drive the grid as instructed.

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

-
* **One massive grid row:** On first render, the product displayed a single stretched row while hiding the rest. Because rows sat in normal flow inside a fixed-height `tbody`, CSS `align-content: stretch` expanded the initial rows and caused `measureElement` to cache inaccurate heights. Positioning body rows absolutely within `tbody` fixed this while preserving the sticky header.
* **Editor flash-and-disappear:** Clicking an hours button opened the editor, which vanished immediately. State was stored inside a virtualized row and reset on remount. Moving state up to the grid and rendering the editor through a portal solved this structurally.
* Both layout bugs bypassed Vitest because it mocks `@tanstack/react-virtual` in jsdom, which lacks layout evaluation. They only appeared during runtime execution.
* Tests passed falsely on leaked DOM because RTL auto-cleanup requires Vitest globals; adding explicit `cleanup()` calls resolved it.
* A known limitation remains: the popover uses fixed positioning at click time and does not track grid scrolling (noted in the worklog).

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

-
* **The editor flash:** I initially shipped a popover with state inside virtualized rows and began setting up Playwright in an Alpine container (downloading browser binaries twice and installing `gcompat` for musl/glibc compatibility) instead of fixing the root cause. You directed me to the portal approach, which resolved the issue immediately.

## What would you do differently with a week?

* Add real-browser testing for the grid via Playwright to catch layout issues jsdom misses.
* Fill deferred test coverage: the 366 and 367 day boundary, "person must be present" `found` flags, non-positive IDs, the 168 upper limit, and fractional hours.
* Make the popover follow or close on scroll rather than staying locked to fixed coordinates.
* Configure `staleTime` and `refetchOnWindowFocus` for capacity queries so external edits sync, and add column virtualization for longer date ranges.

---

### Audit

1. **What makes the draft so obviously AI generated?**
* The repetitive inline bold headers separated by em dashes or colons (`* **Header:** ...`) signal automated structural formatting.
* Heavy overuse of em dashes (`—`) and en dashes (`–`) throughout list definitions.


2. **Does the rewrite state any fact, name, number, date, or citation that isn't in the source?**
* No. All technical specifications, variable names, dates, numbers (`366`, `168`, `400`), identifiers, and framework details are preserved strictly from the source.



---

### Final Rewrite

# Decisions

Yours to write, not your AI's. Short is good: bullets are fine, and half a page is plenty. We read this first.

## What did the spec not tell you?

* ISO weeks start Monday, and `hours_per_day` counts Monday to Friday only. This is the only reading that makes the seed work; Ana's Monday to Sunday 8h/day assignment lands exactly on her 40h capacity, whereas counting weekends gives 56/40. I verified this against the live DB before building.
* The JSON shape was left undefined in the spec. I chose `{weeks: string[], people: [{id, name, weeklyHours, allocations: {weekStart: hours}}]}` because cell lookups are O(1) and capacity belongs to the person rather than the week.
* After a `PATCH`, the grid updates its TanStack Query cache directly from the response (`setQueryData`) with no refetch. That works because allocations do not alter `weeklyHours`, so only the over/under calculation changes. A test guarantees `/api/capacity` is fetched only once.
* `weeklyHours` is required and bounded between 0 and 168. A `*float64` distinguishes a missing field from an explicit 0, which is valid since Eli has 0.
* Enforced `to - from` <= 366 days, returning a 400 error otherwise as a simple payload guard.
* Sorted people with `ORDER BY name, id`. I rejected sorting by "over-allocated first" because rows would jump around when edited.
* Over-allocation is evaluated strictly as `allocated > capacity`. Avoiding division allows Eli's "20 / 0" to render and trigger the flag properly.
* The pink token (`--color-primary-pink`) is reserved for the Save CTA, so over-allocation uses an added rose token (`--color-danger`).
* Used `sqlx` for database access, alongside TanStack Query, Table, and Virtual for the grid as specified.

## What did you notice that looked wrong?

* The product first rendered as a single stretched row with the rest hidden underneath. Because rows sat in normal flow inside a fixed-height `tbody`, CSS `align-content: stretch` expanded those initial rows and caused `measureElement` to cache bad heights. Absolute-positioning body rows inside `tbody` fixed it while keeping the sticky header intact.
* Clicking an hours button opened the editor, which vanished immediately. State lived inside a virtualized row and reset whenever the row remounted. Hoisting state to the grid and rendering the editor via a single portal fixed this structurally.
* Neither layout bug showed up in Vitest because it mocks `@tanstack/react-virtual` in jsdom, which has no layout engine. They only appeared when running the live app.
* Tests passed on leaked DOM because RTL auto-cleanup requires Vitest globals. Adding explicit `cleanup()` calls fixed it.
* Left deliberately as-is: the popover uses fixed positioning at click time and does not track the grid if you scroll while editing (noted in the worklog).

## What did the AI get wrong that you caught?

* When the editor flashed and vanished, I shipped a popover anchored to virtualized rows and started configuring Playwright in an Alpine container (downloading browsers twice and installing `gcompat` for musl/glibc) instead of fixing the obvious bug. You pointed me to the portal approach, which was the structural solution.

## What would you do differently with a week?

* Add real-browser grid tests with Playwright to catch the layout bugs jsdom misses.
* Fill deferred test gaps: 366- and 367-day boundary checks, "person must be present" `found` flags, non-positive IDs, the 168 upper bound, and fractional hours.
* Make the popover track or close on scroll instead of remaining fixed in place.
* Set `staleTime` and `refetchOnWindowFocus` on the capacity query so edits from other sessions sync, and add column virtualization for longer date ranges.