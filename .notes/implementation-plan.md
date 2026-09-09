# Capacity Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three stubbed pieces from the README's "What to build": `GET /api/capacity`, the `CapacityGrid` component, and capacity editing via `PATCH /api/people/{id}` — with tests and commit-as-you-go history on a feature branch.

**Architecture:** One SQL query pivots people × ISO weeks with weekday-only hour aggregation in Postgres; the Go API validates the range and reshapes rows into a nested JSON document; the React grid renders that document and applies PATCH responses to local state (no refetch after edits).

**Tech Stack:** Go 1.26 (stdlib `net/http`, sqlx over the pgx stdlib driver), PostgreSQL 17, React 19 + TypeScript + Vite, Go `testing` (in-container), vitest + @testing-library/react.

**Spec:** `README.md` ("What to build", "Ground rules", "When you're done") and `CLAUDE.md` (conventions, critical rules).

## Global Constraints

- **NEVER edit** `docker-compose.yml`, `api/Dockerfile`, the `Makefile`, `db/schema.sql`, `db/seed.sql`, or `DECISIONS.md`.
- **NEVER commit** `.agents/` or `skills-lock.json` (untracked tooling files).
- Go: return errors, don't panic. Use `writeJSON` for responses. SQL lives in the query string, not assembled from Go strings.
- **All DB access uses `github.com/jmoiron/sqlx`** (user requirement). `server.db` becomes `*sqlx.DB` over the pgx stdlib driver (`_ "github.com/jackc/pgx/v5/stdlib"`); `main.go`'s connection code changes in Task 2. No go.mod changes needed — sqlx is already a dependency.
- TypeScript strict mode is on; `web/` is all TypeScript.
- All work happens on branch `feat/capacity-grid`; commit per task, do not squash.
- Stack is already running via `make up` (attached, foreground). Rebuild only the api service after Go changes with `docker compose up -d --build api` from a second terminal — never `make down`/`make reset`.
- Verification commands run inside containers: `docker compose exec -T api go test ./... -v`, `docker compose exec -T web npm test`, `docker compose exec -T web npm run tsc`.
- Keep `.notes/worklog.md` current: append one short entry per task (decisions, assumptions, dead ends), committed with that task.

## Validated domain facts (already verified against the live seeded DB — do not re-derive)

- **Week model:** ISO weeks, Monday start. `hours_per_day` counts on **weekdays (Mon–Fri) only**. Evidence: the seed is constructed so a full Mon–Sun assignment at 8h/day lands exactly on 40h capacity (Ana, week 2025-12-29: 5×8=40/40). Counting weekends would make her 56/40, contradicting the seed's intent.
- **Expected values** for `from=2025-12-29&to=2026-01-16` (weeks `2025-12-29`, `2026-01-05`, `2026-01-12`), confirmed by running the candidate SQL against the seeded DB:
  - Ana Ferreira (id 1, 40h): 40 / 0 / 30
  - Bo Lindqvist (id 2, 40h): 0 / 32 / 8
  - Cem Aydin (id 3, 20h): 0 / 4 / 12
  - Dee Okafor (id 4, 40h): 0 / 45 / 40  ← over in week 2026-01-05 (deliberate seed)
  - Eli Nakamura (id 5, 0h): 0 / 20 / 0  ← over with zero capacity (deliberate seed)
- **Zero capacity:** `weekly_hours = 0` is valid (Eli). Over-test is strictly `allocated > capacity`; never divide by capacity.
- **Range semantics:** `from`/`to` inclusive; response covers every week intersecting `[from, to]` (from snapped down to its Monday through the week containing `to`).
- **Scale:** 500 people (health endpoint confirms). No pagination.
- Container toolchains confirmed: api has `go version go1.26.8`, web has `node v24.20.0`.

## Design decisions (recorded here; the human defends them in DECISIONS.md)

| Decision | Choice | Why |
|---|---|---|
| Week/hours model | Mon-start weeks; hours count Mon–Fri | Seed math only works this way (see above) |
| JSON shape | `{weeks: string[], people: [{id, name, weeklyHours, allocations: {weekStart: hours}}]}` | Map keyed by week start gives O(1) cell lookup; capacity is person-level, not per-week |
| Post-save sync | Patch local state from the PATCH response | Exactly consistent: allocations don't depend on `weeklyHours`, so only derived over/under display changes. No refetch, no optimistic rollback |
| Hours validation | `weeklyHours` required, 0–168 | 168 = hours in a week; `*float64` distinguishes missing from 0 (0 is valid) |
| Range cap | `to - from ≤ 366 days`, else 400 | Cheap guard against pathological payloads |
| People order | `ORDER BY name, id` | Stable directory order; rejected "over-allocated first" because rows would jump when an edit fixes them |

---

### Task 1: Branch, baseline, plan file

**Files:**
- Create: `.notes/implementation-plan.md` (this file — already written by the planner)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/capacity-grid
```

- [ ] **Step 2: Baseline sanity**

Run: `curl.exe -s http://localhost:8080/api/health`
Expected: `{"ok":true,"people":500}`

- [ ] **Step 3: Commit the plan**

```bash
git add .notes/implementation-plan.md
git commit -m "docs: add implementation plan"
```

---

### Task 2: `GET /api/capacity` (TDD)

**Files:**
- Create: `api/capacity_test.go`
- Modify: `api/capacity.go` (replace stub)
- Modify: `api/main.go` (swap pgxpool → sqlx, per Global Constraints)
- Modify: `.notes/worklog.md` (append entry)

**Interfaces:**
- Consumes: `server.db` (*sqlx.DB), `writeJSON(w, status, v)` from `main.go`.
- Produces: `GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD` → 200 `capacityResponse`:
  ```json
  {"weeks": ["2025-12-29"], "people": [{"id": 1, "name": "Ana Ferreira", "weeklyHours": 40, "allocations": {"2025-12-29": 40}}]}
  ```
  400 for missing/invalid params, `to < from`, or range > 366 days. Task 3's test calls this endpoint to verify PATCH side effects.

- [ ] **Step 1: Write the failing test**

Create `api/capacity_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/stdlib"
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
	t.Cleanup(db.Close)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T api go test ./... -v`
Expected: FAIL — compile error (`capacityResponse` undefined) or 501 from the stub.

- [ ] **Step 3: Write the implementation**

Replace `api/capacity.go` entirely:

```go
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
SELECT p.id, p.name, p.weekly_hours::float8, wd.week_start, COALESCE(SUM(a.hours_per_day), 0)::float8 AS allocated
FROM people p
CROSS JOIN week_days wd
LEFT JOIN assignments a
  ON a.person_id = p.id
 AND wd.day BETWEEN a.start_date AND a.end_date
GROUP BY p.id, p.name, p.weekly_hours, wd.week_start
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
```

Note: the weeks dedup relies on `ORDER BY p.name, p.id, wd.week_start` — every person has every week (CROSS JOIN), weeks ascend within each person, so the first person contributes all weeks in order.

Also replace `api/main.go` with this sqlx version (pgxpool → `*sqlx.DB` over the pgx stdlib driver; the health check uses `GetContext`):

```go
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

type server struct {
	db *sqlx.DB
}

func main() {
	ctx := context.Background()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://capacity:capacity@localhost:5432/capacity?sslmode=disable"
	}

	db, err := sqlx.Open("pgx", dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer db.Close()

	for i := 0; i < 30; i++ {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = db.PingContext(pingCtx)
		cancel()
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatalf("ping: %v", err)
	}

	s := &server{db: db}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/capacity", s.handleCapacity)
	mux.HandleFunc("PATCH /api/people/{id}", s.handleUpdatePerson)

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	var people int
	if err := s.db.GetContext(r.Context(), &people, `SELECT count(*) FROM people`); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "people": people})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 4: Rebuild the api and run the tests**

```bash
docker compose up -d --build api
docker compose exec -T api go test ./... -v
```

Expected: `TestHandleCapacityKnownValues` and `TestHandleCapacityBadRequests` PASS.

- [ ] **Step 5: Curl eyeball against the running API**

Run: `curl.exe -s "http://localhost:8080/api/capacity?from=2025-12-29&to=2026-01-16"`
Expected: weeks `["2025-12-29","2026-01-05","2026-01-12"]`; Dee Okafor has `"2026-01-05": 45` with `"weeklyHours": 40`; Eli Nakamura has `"2026-01-05": 20` with `"weeklyHours": 0`.

Run: `curl.exe -s -o NUL -w "%{http_code}" "http://localhost:8080/api/capacity?from=nope&to=2026-01-16"`
Expected: `400`

- [ ] **Step 6: Worklog entry and commit**

Append to `.notes/worklog.md`:

```markdown
## GET /api/capacity

- Weekday-only hours: the seed only makes sense that way — Ana's Mon–Sun 8h/day
  assignment lands exactly on her 40h capacity when weekends don't count.
- JSON shape: weeks array + per-person allocations map keyed by week start, so
  the grid gets O(1) cell lookup and capacity stays a person-level value.
- Capped ranges at 366 days to bound payload size.
- DB access via sqlx (SelectContext into capacityRow); main.go's server.db is
  now *sqlx.DB over the pgx stdlib driver.
```

```bash
git add api/capacity.go api/capacity_test.go api/main.go .notes/worklog.md
git commit -m "feat(api): implement GET /api/capacity"
```

---

### Task 3: `PATCH /api/people/{id}` (TDD)

**Files:**
- Create: `api/people_test.go`
- Modify: `api/people.go` (replace stub)
- Modify: `.notes/worklog.md` (append entry)

**Interfaces:**
- Consumes: `getCapacity`, `testServer` from `api/capacity_test.go` (same package).
- Produces: `PATCH /api/people/{id}` with body `{"weeklyHours": number}` → 200 `personResponse{id, name, weeklyHours}`; 400 for bad id/body/value; 404 for unknown id. The web editor (Task 5) consumes `personResponse` as its `Person` type.

- [ ] **Step 1: Write the failing test**

Create `api/people_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T api go test ./... -run TestHandleUpdatePerson -v`
Expected: FAIL — compile error (`personResponse` undefined) or 501 from the stub.

- [ ] **Step 3: Write the implementation**

Replace `api/people.go` entirely:

```go
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
```

- [ ] **Step 4: Rebuild the api and run the tests**

```bash
docker compose up -d --build api
docker compose exec -T api go test ./... -v
```

Expected: all tests PASS (capacity tests still green too).

- [ ] **Step 5: Curl eyeball**

```bash
curl.exe -s -X PATCH -H "Content-Type: application/json" -d "{\"weeklyHours\": 32}" http://localhost:8080/api/people/1
curl.exe -s "http://localhost:8080/api/capacity?from=2025-12-29&to=2025-12-29"
curl.exe -s -X PATCH -H "Content-Type: application/json" -d "{\"weeklyHours\": 40}" http://localhost:8080/api/people/1
```

Expected: first PATCH returns `{"id":1,"name":"Ana Ferreira","weeklyHours":32}`; capacity shows Ana at 32 with allocation still 40; restore returns 40.

- [ ] **Step 6: Worklog entry and commit**

Append to `.notes/worklog.md`:

```markdown
## PATCH /api/people/{id}

- weeklyHours validated to [0, 168]; *float64 so a missing field is distinct
  from an explicit 0 (Eli really has 0 hours).
- Returns the updated person; the grid patches local state from it instead of
  refetching the whole range.
- Tests restore Ana to 40h afterwards so the seed stays pristine.
- Update via sqlx GetContext (RETURNING row scanned into personResponse;
  sql.ErrNoRows → 404).
```

```bash
git add api/people.go api/people_test.go .notes/worklog.md
git commit -m "feat(api): implement PATCH /api/people/{id}"
```

---

### Task 4: `CapacityGrid` render + vitest setup (TDD)

**Files:**
- Modify: `web/package.json` (via npm install + script add)
- Create: `web/vitest.config.ts`
- Create: `web/src/CapacityGrid.test.tsx`
- Modify: `web/src/CapacityGrid.tsx` (replace stub)
- Create: `web/src/WeeklyHoursEditor.tsx` (minimal placeholder; Task 5 replaces it)
- Modify: `web/src/styles.css` (append grid styles)
- Modify: `.notes/worklog.md` (append entry)

**Interfaces:**
- Consumes: `GET /api/capacity` response from Task 2.
- Produces: exported `Person` type (`{id: number, name: string, weeklyHours: number, allocations: Record<string, number>}`) consumed by `WeeklyHoursEditor`; `formatHours`, `formatWeek` helpers.

- [ ] **Step 1: Install test dependencies and add the test script**

```bash
docker compose exec -T web npm install -D vitest @testing-library/react @testing-library/user-event jsdom
```

This updates `web/package.json` and `web/package-lock.json` on the bind mount. Then add to `web/package.json` scripts:

```json
"test": "vitest run"
```

- [ ] **Step 2: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
})
```

(`vite.config.ts` itself stays untouched.)

- [ ] **Step 3: Write the failing test**

Create `web/src/CapacityGrid.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapacityGrid } from './CapacityGrid'

const fixture = {
  weeks: ['2025-12-29', '2026-01-05'],
  people: [
    { id: 1, name: 'Ana Ferreira', weeklyHours: 40, allocations: { '2025-12-29': 40, '2026-01-05': 0 } },
    { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocations: { '2025-12-29': 0, '2026-01-05': 45 } },
    { id: 5, name: 'Eli Nakamura', weeklyHours: 0, allocations: { '2025-12-29': 0, '2026-01-05': 20 } },
  ],
}

function stubCapacityFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify(fixture), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CapacityGrid', () => {
  it('renders a row per person and a column per week', async () => {
    stubCapacityFetch()
    render(<CapacityGrid from="2025-12-29" to="2026-01-05" />)

    expect(await screen.findByText('Ana Ferreira')).toBeTruthy()
    expect(screen.getByText('Dee Okafor')).toBeTruthy()
    expect(screen.getByText('Eli Nakamura')).toBeTruthy()
    expect(screen.getByText('Dec 29')).toBeTruthy()
    expect(screen.getByText('Jan 5')).toBeTruthy()
  })

  it('marks over-allocated cells', async () => {
    stubCapacityFetch()
    render(<CapacityGrid from="2025-12-29" to="2026-01-05" />)

    const deeCell = (await screen.findByText('45 / 40')).closest('td')
    expect(deeCell?.className).toBe('over')
    const eliCell = screen.getByText('20 / 0').closest('td')
    expect(eliCell?.className).toBe('over')
    const anaCell = screen.getByText('40 / 40').closest('td')
    expect(anaCell?.className).not.toBe('over')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `docker compose exec -T web npm test`
Expected: FAIL — the stub renders "Nothing here yet", so `findByText('Ana Ferreira')` times out.

- [ ] **Step 5: Implement the grid**

Replace `web/src/CapacityGrid.tsx` entirely:

```tsx
import { useEffect, useState } from 'react'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'

type Props = {
  from: string
  to: string
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
  allocations: Record<string, number>
}

type CapacityResponse = {
  weeks: string[]
  people: Person[]
}

export function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}

export function formatWeek(iso: string): string {
  // Parse as UTC so local timezones don't shift the displayed day.
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function CapacityGrid({ from, to }: Props) {
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    fetch(`/api/capacity?from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/capacity failed: ${res.status}`)
        return res.json() as Promise<CapacityResponse>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const handleSaved = (updated: Person) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            people: prev.people.map((p) =>
              p.id === updated.id ? { ...p, weeklyHours: updated.weeklyHours } : p,
            ),
          }
        : prev,
    )
  }

  if (error) return <p role="alert">Could not load capacity: {error}</p>
  if (!data) return <p>Loading…</p>

  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Person</th>
          {data.weeks.map((w) => (
            <th scope="col" key={w}>
              {formatWeek(w)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.people.map((p) => (
          <tr key={p.id}>
            <th scope="row">
              {p.name}{' '}
              <WeeklyHoursEditor person={p} onSaved={handleSaved} />
            </th>
            {data.weeks.map((w) => {
              const allocated = p.allocations[w] ?? 0
              const over = allocated > p.weeklyHours
              return (
                <td key={w} className={over ? 'over' : undefined}>
                  {formatHours(allocated)} / {formatHours(p.weeklyHours)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

Create `web/src/WeeklyHoursEditor.tsx` as a minimal placeholder (Task 5 replaces it):

```tsx
import type { Person } from './CapacityGrid'

type Props = {
  person: Person
  onSaved: (updated: Person) => void
}

// Placeholder — Task 5 turns this into an inline editor.
export function WeeklyHoursEditor({ person }: Props) {
  return (
    <button type="button" className="hours">
      {person.weeklyHours}h/wk
    </button>
  )
}
```

Append to `web/src/styles.css`:

```css
td.over {
  background: color-mix(in srgb, #d33 25%, transparent);
  font-weight: 600;
}

button.hours {
  font: inherit;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  padding: 0.1rem 0.4rem;
  cursor: pointer;
}

.hours-editor input {
  width: 4.5rem;
  font: inherit;
}

.hours-editor .error {
  color: #d33;
  margin-left: 0.5rem;
}
```

- [ ] **Step 6: Run tests and type-check**

```bash
docker compose exec -T web npm test
docker compose exec -T web npm run tsc
```

Expected: both vitest tests PASS; tsc exits clean.

- [ ] **Step 7: Verify the vite proxy wiring end-to-end**

Run: `curl.exe -s http://localhost:3000/api/health`
Expected: `{"ok":true,"people":500}` (proves the browser's `/api` calls reach the API through the dev-server proxy, without opening a browser).

- [ ] **Step 8: Worklog entry and commit**

Append to `.notes/worklog.md`:

```markdown
## CapacityGrid render

- Cells show "allocated / capacity"; over-allocation is `allocated > capacity`
  (strictly — 40/40 is exactly full, not over) with a red-tinted `td.over`.
- Zero capacity (Eli) renders as "20 / 0" and flags over; no division anywhere.
- People ordered by name server-side; week headers formatted client-side as
  "Dec 29" etc., parsed as UTC to avoid timezone drift.
```

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/CapacityGrid.tsx web/src/CapacityGrid.test.tsx web/src/WeeklyHoursEditor.tsx web/src/styles.css .notes/worklog.md
git commit -m "feat(web): render capacity grid"
```

---

### Task 5: Edit weekly hours from the grid (TDD)

**Files:**
- Modify: `web/src/CapacityGrid.test.tsx` (add editing test)
- Modify: `web/src/WeeklyHoursEditor.tsx` (replace placeholder)
- Modify: `.notes/worklog.md` (append entry)

**Interfaces:**
- Consumes: `PATCH /api/people/{id}` from Task 3 (returns `Person`); `Person` type and `handleSaved` prop contract from Task 4.
- Produces: `WeeklyHoursEditor` with props `{person: Person, onSaved: (updated: Person) => void}`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('CapacityGrid')` block in `web/src/CapacityGrid.test.tsx` (also add `within` to the `@testing-library/react` import and `userEvent` import at top: `import userEvent from '@testing-library/user-event'`):

```tsx
  it('updates weekly hours locally after a save, without refetching capacity', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/capacity')) {
        return new Response(JSON.stringify(fixture), { status: 200 })
      }
      if (url === '/api/people/4' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ id: 4, name: 'Dee Okafor', weeklyHours: 32 }),
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<CapacityGrid from="2025-12-29" to="2026-01-05" />)

    await screen.findByText('45 / 40')
    const deeRow = screen.getByText('Dee Okafor').closest('tr')!
    await user.click(within(deeRow).getByRole('button', { name: '40h/wk' }))
    const input = screen.getByLabelText('Weekly hours for Dee Okafor')
    await user.clear(input)
    await user.type(input, '32')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const cell = (await screen.findByText('45 / 32')).closest('td')
    expect(cell?.className).toBe('over')

    const capacityCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('/api/capacity'),
    )
    expect(capacityCalls).toHaveLength(1)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T web npm test`
Expected: FAIL — no `Save` button exists yet (placeholder editor is inert).

- [ ] **Step 3: Implement the editor**

Replace `web/src/WeeklyHoursEditor.tsx` entirely:

```tsx
import { useState } from 'react'
import type { Person } from './CapacityGrid'

type Props = {
  person: Person
  onSaved: (updated: Person) => void
}

export function WeeklyHoursEditor({ person, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => {
    setValue(String(person.weeklyHours))
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const hours = Number(value)
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      setError('Enter a number between 0 and 168')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/people/${person.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyHours: hours }),
      })
      if (!res.ok) throw new Error(`save failed: ${res.status}`)
      const updated = (await res.json()) as Person
      onSaved(updated)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" className="hours" onClick={startEdit}>
        {person.weeklyHours}h/wk
      </button>
    )
  }

  return (
    <span className="hours-editor">
      <input
        type="number"
        min={0}
        max={168}
        value={value}
        autoFocus
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') setEditing(false)
        }}
        aria-label={`Weekly hours for ${person.name}`}
      />
      <button type="button" onClick={() => void save()} disabled={saving}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={saving}>
        Cancel
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Run tests and type-check**

```bash
docker compose exec -T web npm test
docker compose exec -T web npm run tsc
```

Expected: all 3 vitest tests PASS; tsc clean.

- [ ] **Step 5: Worklog entry and commit**

Append to `.notes/worklog.md`:

```markdown
## Editing from the grid

- After a save the grid patches local state from the PATCH response — no
  refetch. This is exactly consistent here because allocations don't depend on
  weeklyHours; only the derived over/under display changes. A test pins this by
  asserting /api/capacity is fetched exactly once.
- Editor is a small inline control in the name cell: click "40h/wk", type,
  Enter/Save or Esc/Cancel. Client validates 0–168 before sending.
```

```bash
git add web/src/WeeklyHoursEditor.tsx web/src/CapacityGrid.test.tsx .notes/worklog.md
git commit -m "feat(web): edit weekly hours from the grid"
```

---

### Task 6: Final verification and handoff

**Files:**
- Modify: `.notes/worklog.md` (final entry)

- [ ] **Step 1: Full suite green**

```bash
docker compose exec -T api go test ./... -v
docker compose exec -T web npm test
docker compose exec -T web npm run tsc
```

Expected: everything PASS.

- [ ] **Step 2: Confirm seed is pristine**

Run: `curl.exe -s "http://localhost:8080/api/capacity?from=2025-12-29&to=2026-01-16"` and check Ana is back at `"weeklyHours": 40`.

- [ ] **Step 3: Human visual check**

Ask the user to open http://localhost:3000 and look at the grid (README's explicit ask). Give them this expected-numbers table for the first rows:

| Person | Dec 29 | Jan 5 | Jan 12 |
|---|---|---|---|
| Ana Ferreira (40h) | 40 / 40 | 0 / 40 | 30 / 40 |
| Bo Lindqvist (40h) | 0 / 40 | 32 / 40 | 8 / 40 |
| Cem Aydin (20h) | 0 / 20 | 4 / 20 | 12 / 20 |
| Dee Okafor (40h) | 0 / 40 | **45 / 40 (over)** | 40 / 40 |
| Eli Nakamura (0h) | 0 / 0 | **20 / 0 (over)** | 0 / 0 |

Also: edit someone's hours in the UI and confirm the cells update immediately.

- [ ] **Step 4: Final worklog entry and commit**

Append to `.notes/worklog.md`:

```markdown
## Left out deliberately

- No pagination/filtering/virtualization: 500 rows × a handful of columns
  renders fine; flagged as a live-extension topic.
- No column sorting: name order is stable and findable; "over-allocated first"
  was rejected because rows would jump when an edit fixes them.
```

```bash
git add .notes/worklog.md
git commit -m "docs: final worklog notes"
```

- [ ] **Step 5: Hand the user DECISIONS.md talking points**

Do NOT write `DECISIONS.md` (it is the human's file). Summarize for them: weekday assumption + evidence, JSON shape choice, patch-don't-refetch strategy, 0–168 validation, 366-day cap, name ordering, zero-capacity handling, and anything noticed that looked off.

---

## Self-review (completed by the planner)

- **Spec coverage:** README item 1 → Task 2; item 2 → Task 4; item 3 → Tasks 3+5; "write it down" → worklog entries + Task 6. ✓
- **Type consistency:** `personResponse` (Go) ↔ `Person` (TS) share `id/name/weeklyHours`; `allocations` keyed by the same `YYYY-MM-DD` week strings the SQL emits; `getCapacity`/`testServer` shared between API test files. ✓
- **No placeholders:** every code step contains complete code. ✓
- **Risks:** pgx `numeric`→`float64` scan (standard, supported); `docker compose up -d --build api` alongside the attached `make up` (known-good pattern); npm version drift on new devDeps (resolved into the lockfile at install time).
