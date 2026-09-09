package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func patchPerson(t *testing.T, s *server, id string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/people/"+id, bytes.NewBufferString(body))
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	s.handleUpdatePerson(rec, req)
	return rec
}

func TestHandleUpdatePerson(t *testing.T) {
	s := testServer(t)

	rec := patchPerson(t, s, "1", `{"weeklyHours": 32}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body)
	}
	var p personResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.ID != 1 || p.Name != "Ana Ferreira" || p.WeeklyHours != 32 {
		t.Fatalf("person = %+v, want id 1, Ana Ferreira, 32", p)
	}
	// Leave the seed data pristine for later tasks and manual checks.
	defer func() {
		if rec := patchPerson(t, s, "1", `{"weeklyHours": 40}`); rec.Code != http.StatusOK {
			t.Fatalf("restore failed: %d %s", rec.Code, rec.Body)
		}
	}()

	// Capacity for Ana's first week must reflect the new capacity while
	// allocations are untouched.
	_, cap1 := getCapacity(t, s, "/api/capacity?from=2025-12-29&to=2025-12-29")
	for _, person := range cap1.People {
		if person.ID == 1 {
			if person.WeeklyHours != 32 {
				t.Errorf("capacity weeklyHours = %v, want 32", person.WeeklyHours)
			}
			if got := person.Allocations["2025-12-29"]; got != 40 {
				t.Errorf("allocation = %v, want 40 (unchanged)", got)
			}
		}
	}
}

func TestHandleUpdatePersonZeroHours(t *testing.T) {
	s := testServer(t)
	// 0 is a valid value (Eli Nakamura has 0) and must not be treated as missing.
	rec := patchPerson(t, s, "5", `{"weeklyHours": 0}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body)
	}
	var p personResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.WeeklyHours != 0 {
		t.Errorf("weeklyHours = %v, want 0", p.WeeklyHours)
	}
}

func TestHandleUpdatePersonBadRequests(t *testing.T) {
	s := testServer(t)
	cases := []struct {
		id     string
		body   string
		status int
	}{
		{"abc", `{"weeklyHours": 32}`, http.StatusBadRequest},
		{"1", `not json`, http.StatusBadRequest},
		{"1", `{}`, http.StatusBadRequest},
		{"1", `{"weeklyHours": -5}`, http.StatusBadRequest},
		{"1", `{"weeklyHours": 200}`, http.StatusBadRequest},
		{"999999", `{"weeklyHours": 32}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		if rec := patchPerson(t, s, tc.id, tc.body); rec.Code != tc.status {
			t.Errorf("PATCH /api/people/%s body %s: status = %d, want %d", tc.id, tc.body, rec.Code, tc.status)
		}
	}
}
