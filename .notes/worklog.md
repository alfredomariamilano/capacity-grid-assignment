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
