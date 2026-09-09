package main

import (
	"net/http"
	"time"
)

// capacityRow is one row of the capacity SQL result: a person's allocation for
// a single week. db tags match the SELECT aliases.
type capacityRow struct {
	ID          int       `db:"id"`
	Name        string    `db:"name"`
	WeeklyHours float64   `db:"weekly_hours"`
	WeekStart   time.Time `db:"week_start"`
	Allocated   float64   `db:"allocated"`
}

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// For every person and every ISO week (Monday start) intersecting the
// inclusive [from, to] range, it returns allocated hours and weekly capacity.
// Allocated hours count weekdays (Mon–Fri) only: hours_per_day is a working-day
// rate, and the seed data is built so that a full Mon–Sun assignment at 8h/day
// lands exactly on a 40h capacity.
type capacityResponse struct {
	Weeks  []string         `json:"weeks"`
	People []capacityPerson `json:"people"`
}

type capacityPerson struct {
	ID          int                `json:"id"`
	Name        string             `json:"name"`
	WeeklyHours float64            `json:"weeklyHours"`
	Allocations map[string]float64 `json:"allocations"`
}

func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		http.Error(w, "from and to query parameters are required", http.StatusBadRequest)
		return
	}
	from, err := time.Parse("2006-01-02", fromStr)
	if err != nil {
		http.Error(w, "invalid from date, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	to, err := time.Parse("2006-01-02", toStr)
	if err != nil {
		http.Error(w, "invalid to date, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	if to.Before(from) {
		http.Error(w, "to must not be before from", http.StatusBadRequest)
		return
	}
	if to.Sub(from) > 366*24*time.Hour {
		http.Error(w, "range too large, maximum 366 days", http.StatusBadRequest)
		return
	}

	// One row per person per week. week_days expands each week to Mon–Fri so
	// weekend days inside an assignment's date range don't count. ::float8
	// casts make the numeric columns unambiguous under database/sql.
	const query = `
WITH weeks AS (
  SELECT generate_series(date_trunc('week', $1::date), date_trunc('week', $2::date), interval '7 days')::date AS week_start
),
week_days AS (
  SELECT week_start, (week_start + n)::date AS day
  FROM weeks, generate_series(0, 4) AS n
)
SELECT p.id, p.name, p.weekly_hours::float8, wd.week_start, COALESCE(o.hours::float8, SUM(a.hours_per_day), 0)::float8 AS allocated
FROM people p
CROSS JOIN week_days wd
LEFT JOIN assignments a
  ON a.person_id = p.id
 AND wd.day BETWEEN a.start_date AND a.end_date
LEFT JOIN allocation_overrides o
  ON o.person_id = p.id
 AND o.week_start = wd.week_start
GROUP BY p.id, p.name, p.weekly_hours, wd.week_start, o.hours
ORDER BY p.name, p.id, wd.week_start`

	rows := []capacityRow{}
	if err := s.db.SelectContext(r.Context(), &rows, query, fromStr, toStr); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := capacityResponse{Weeks: []string{}, People: []capacityPerson{}}
	seenWeeks := map[string]bool{}
	for _, row := range rows {
		week := row.WeekStart.Format("2006-01-02")
		if !seenWeeks[week] {
			seenWeeks[week] = true
			resp.Weeks = append(resp.Weeks, week)
		}
		if len(resp.People) == 0 || resp.People[len(resp.People)-1].ID != row.ID {
			resp.People = append(resp.People, capacityPerson{
				ID:          row.ID,
				Name:        row.Name,
				WeeklyHours: row.WeeklyHours,
				Allocations: map[string]float64{},
			})
		}
		last := &resp.People[len(resp.People)-1]
		last.Allocations[week] = row.Allocated
	}

	writeJSON(w, http.StatusOK, resp)
}
