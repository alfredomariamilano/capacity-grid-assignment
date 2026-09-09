package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// The assignments table is computed from the frozen schema; per-week
// allocation edits are stored here and override the computed value in the
// capacity query. Created at startup so the run environment's schema/seed
// files never need touching.
const createOverridesTable = `
CREATE TABLE IF NOT EXISTS allocation_overrides (
  person_id  int     NOT NULL REFERENCES people(id),
  week_start date    NOT NULL,
  hours      numeric NOT NULL,
  PRIMARY KEY (person_id, week_start)
)`

type updateAllocationRequest struct {
	Hours *float64 `json:"hours"`
}

// handleUpdateAllocation serves PATCH /api/people/{id}/allocations/{week}
//
// Body: {"hours": number}, required, in [0, 168] (0 is valid). Upserts the
// override for that person/week and returns {"id", "week", "hours"}. The
// grid patches its local cache from this response.
func (s *server) handleUpdateAllocation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid person id", http.StatusBadRequest)
		return
	}
	week := r.PathValue("week")
	if _, err := time.Parse("2006-01-02", week); err != nil {
		http.Error(w, "invalid week, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}

	var req updateAllocationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.Hours == nil {
		http.Error(w, "hours is required", http.StatusBadRequest)
		return
	}
	if *req.Hours < 0 || *req.Hours > 168 {
		http.Error(w, "hours must be between 0 and 168", http.StatusBadRequest)
		return
	}

	var exists int
	err = s.db.GetContext(r.Context(), &exists, `SELECT 1 FROM people WHERE id = $1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "person not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := s.db.ExecContext(r.Context(),
		`INSERT INTO allocation_overrides (person_id, week_start, hours)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (person_id, week_start) DO UPDATE SET hours = EXCLUDED.hours`,
		id, week, *req.Hours,
	); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"id": id, "week": week, "hours": *req.Hours})
}
