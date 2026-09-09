package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

func testServer(t *testing.T) *server {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	db, err := sqlx.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if _, err := db.ExecContext(ctx, createOverridesTable); err != nil {
		t.Fatalf("ensure allocation_overrides table: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &server{db: db}
}

func getCapacity(t *testing.T, s *server, url string) (*httptest.ResponseRecorder, capacityResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	s.handleCapacity(rec, req)
	var resp capacityResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
	return rec, resp
}

func TestHandleCapacityKnownValues(t *testing.T) {
	s := testServer(t)
	// Allocation overrides are test-controlled; start from a clean slate so
	// leftover overrides from other tests cannot skew the known values.
	if _, err := s.db.Exec(`DELETE FROM allocation_overrides`); err != nil {
		t.Fatalf("clear overrides: %v", err)
	}
	rec, resp := getCapacity(t, s, "/api/capacity?from=2025-12-29&to=2026-01-16")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body)
	}

	wantWeeks := []string{"2025-12-29", "2026-01-05", "2026-01-12"}
	if len(resp.Weeks) != len(wantWeeks) {
		t.Fatalf("weeks = %v, want %v", resp.Weeks, wantWeeks)
	}
	for i, w := range wantWeeks {
		if resp.Weeks[i] != w {
			t.Fatalf("weeks = %v, want %v", resp.Weeks, wantWeeks)
		}
	}

	if len(resp.People) != 500 {
		t.Fatalf("people = %d, want 500", len(resp.People))
	}

	byID := map[int]capacityPerson{}
	for _, p := range resp.People {
		byID[p.ID] = p
	}

	cases := []struct {
		id          int
		name        string
		weeklyHours float64
		allocations map[string]float64
	}{
		{1, "Ana Ferreira", 40, map[string]float64{"2025-12-29": 40, "2026-01-05": 0, "2026-01-12": 30}},
		{2, "Bo Lindqvist", 40, map[string]float64{"2025-12-29": 0, "2026-01-05": 32, "2026-01-12": 8}},
		{3, "Cem Aydin", 20, map[string]float64{"2025-12-29": 0, "2026-01-05": 4, "2026-01-12": 12}},
		{4, "Dee Okafor", 40, map[string]float64{"2025-12-29": 0, "2026-01-05": 45, "2026-01-12": 40}},
		{5, "Eli Nakamura", 0, map[string]float64{"2025-12-29": 0, "2026-01-05": 20, "2026-01-12": 0}},
	}
	for _, tc := range cases {
		p, ok := byID[tc.id]
		if !ok {
			t.Fatalf("person %d not in response", tc.id)
		}
		if p.Name != tc.name || p.WeeklyHours != tc.weeklyHours {
			t.Errorf("person %d = %+v, want name %q weeklyHours %v", tc.id, p, tc.name, tc.weeklyHours)
		}
		for week, want := range tc.allocations {
			if got := p.Allocations[week]; got != want {
				t.Errorf("person %d week %s: allocated = %v, want %v", tc.id, week, got, want)
			}
		}
	}
}

func TestHandleCapacityBadRequests(t *testing.T) {
	s := testServer(t)
	urls := []string{
		"/api/capacity",
		"/api/capacity?from=2025-12-29",
		"/api/capacity?from=nope&to=2026-01-16",
		"/api/capacity?from=2025-12-29&to=nope",
		"/api/capacity?from=2026-01-16&to=2025-12-29",
		"/api/capacity?from=2025-01-01&to=2026-12-31",
	}
	for _, u := range urls {
		rec, _ := getCapacity(t, s, u)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("GET %s: status = %d, want 400", u, rec.Code)
		}
	}
}
