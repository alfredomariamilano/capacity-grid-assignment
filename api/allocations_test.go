package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func patchAllocation(t *testing.T, s *server, id, week, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/people/"+id+"/allocations/"+week, bytes.NewBufferString(body))
	req.SetPathValue("id", id)
	req.SetPathValue("week", week)
	rec := httptest.NewRecorder()
	s.handleUpdateAllocation(rec, req)
	return rec
}

func TestHandleUpdateAllocation(t *testing.T) {
	s := testServer(t)

	rec := patchAllocation(t, s, "1", "2026-01-05", `{"hours": 26}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body)
	}
	var resp struct {
		ID    int     `json:"id"`
		Week  string  `json:"week"`
		Hours float64 `json:"hours"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ID != 1 || resp.Week != "2026-01-05" || resp.Hours != 26 {
		t.Fatalf("resp = %+v, want id 1, week 2026-01-05, hours 26", resp)
	}
	// Leave the seeded data effect-free: remove the override after the test.
	defer func() {
		if _, err := s.db.Exec(`DELETE FROM allocation_overrides WHERE person_id = 1 AND week_start = '2026-01-05'`); err != nil {
			t.Fatalf("cleanup: %v", err)
		}
	}()

	// Capacity now reflects the override instead of the computed value
	// (Ana's computed allocation for week 2026-01-05 is 0).
	_, capResp := getCapacity(t, s, "/api/capacity?from=2026-01-05&to=2026-01-05")
	for _, p := range capResp.People {
		if p.ID == 1 {
			if got := p.Allocations["2026-01-05"]; got != 26 {
				t.Errorf("allocated = %v, want 26 (override)", got)
			}
		}
	}
}

func TestHandleUpdateAllocationInvalid(t *testing.T) {
	s := testServer(t)
	cases := []struct {
		id     string
		week   string
		body   string
		status int
	}{
		{"abc", "2026-01-05", `{"hours": 8}`, http.StatusBadRequest},
		{"1", "not-a-week", `{"hours": 8}`, http.StatusBadRequest},
		{"1", "2026-01-05", `not json`, http.StatusBadRequest},
		{"1", "2026-01-05", `{}`, http.StatusBadRequest},
		{"1", "2026-01-05", `{"hours": -5}`, http.StatusBadRequest},
		{"1", "2026-01-05", `{"hours": 200}`, http.StatusBadRequest},
		{"999999", "2026-01-05", `{"hours": 8}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		if rec := patchAllocation(t, s, tc.id, tc.week, tc.body); rec.Code != tc.status {
			t.Errorf("PATCH /api/people/%s/allocations/%s body %s: status = %d, want %d", tc.id, tc.week, tc.body, rec.Code, tc.status)
		}
	}
}
