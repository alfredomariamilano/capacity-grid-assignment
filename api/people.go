package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

// handleUpdatePerson serves PATCH /api/people/{id}
//
// Body: {"weeklyHours": number}. weeklyHours is required and must be in
// [0, 168] (hours in a week); 0 is valid. Returns the updated person so the
// caller can patch its local state without refetching.
type personResponse struct {
	ID          int     `db:"id" json:"id"`
	Name        string  `db:"name" json:"name"`
	WeeklyHours float64 `db:"weekly_hours" json:"weeklyHours"`
}

type updatePersonRequest struct {
	WeeklyHours *float64 `json:"weeklyHours"`
}

func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		http.Error(w, "invalid person id", http.StatusBadRequest)
		return
	}

	var req updatePersonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.WeeklyHours == nil {
		http.Error(w, "weeklyHours is required", http.StatusBadRequest)
		return
	}
	if *req.WeeklyHours < 0 || *req.WeeklyHours > 168 {
		http.Error(w, "weeklyHours must be between 0 and 168", http.StatusBadRequest)
		return
	}

	var p personResponse
	err = s.db.GetContext(r.Context(), &p,
		`UPDATE people SET weekly_hours = $1 WHERE id = $2 RETURNING id, name, weekly_hours`,
		*req.WeeklyHours, id,
	)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "person not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, p)
}
