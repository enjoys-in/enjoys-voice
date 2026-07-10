# Call Analytics / Personal Dashboard

> **Goal:** give the single user a **personal** view of their calling activity —
> not the admin-level engine metrics (active calls, CPS, trunk status) but a
> self-focused summary: how many calls *you* made, who *you* talk to most, how
> much *you* spent, and how your usage trends over time.
>
> **What already exists to build on:**
>   - Admin dashboard (`web/app/admin/page.tsx` OverviewTab): live engine metrics,
>     call-volume charts, status breakdown, spend-over-time. Uses recharts.
>   - Go stats endpoint (`GET /api/g/stats`): aggregates `call_records` —
>     `totalCalls`, `answeredCalls`, `avgDuration`, `totalCost`, per-day buckets.
>     Currently **global** (all users), not per-extension.
>   - Call records in Postgres: `call_records` table with `from_ext`, `to_ext`,
>     `direction`, `status`, `duration`, `cost`, `started_at`, `ended_at`.
>   - Billing data: `cost`, `currency`, `billed_secs`, `rate_prefix` per call.
>   - Contact store: `contacts` table + `contact.store.ts` for name resolution.
>   - Recents: `CallsScreen.tsx` shows call history but no analytics.

## Go API — Per-User Stats Endpoint

- [ ] New endpoint: `GET /api/g/stats/me` — same structure as `/api/g/stats` but
      filtered to the JWT user's extension. Query `call_records` where
      `from_ext = :ext OR to_ext = :ext`.
- [ ] Response shape:
      ```json
      {
        "totalCalls": 142,
        "outbound": 89,
        "inbound": 53,
        "answered": 128,
        "missed": 14,
        "avgDurationSecs": 252,
        "totalTalkTimeMins": 596,
        "totalCost": 12.45,
        "currency": "USD",
        "topContacts": [
          { "number": "+919800000001", "name": "Mom", "count": 34, "totalMins": 120 },
          { "number": "1002", "name": "Bob Brown", "count": 22, "totalMins": 45 }
        ],
        "dailyBuckets": [
          { "date": "2026-07-01", "calls": 8, "minutes": 32, "cost": 1.20 },
          ...
        ],
        "weeklyBuckets": [...],
        "monthlyBuckets": [...]
      }
      ```
- [ ] `topContacts`: `GROUP BY` the remote party (the other leg's extension or
      phone number), `COUNT(*)` + `SUM(duration)`, `ORDER BY count DESC LIMIT 10`.
      Join with `contacts` or `users` for names.
- [ ] `dailyBuckets`: `DATE_TRUNC('day', started_at)` → count + sum(duration) +
      sum(cost). Default last 30 days. Accept `?from=&to=` query params for range.
- [ ] `weeklyBuckets` / `monthlyBuckets`: same pattern with `'week'` / `'month'`
      truncation. Useful for the trend charts.
- [ ] Repository: new `PersonalStats(extension, from, to)` method in
      `call_repo.go`. Single query with CTEs for efficiency.

## Frontend — Personal Analytics Screen

- [ ] New `AnalyticsScreen.tsx` (`web/app/components/screens/AnalyticsScreen.tsx`):
      accessible from the main nav or a button in the Recents screen header.

### Summary Cards (top row)

- [ ] **Calls this week**: total count with a small trend indicator (↑12% vs last
      week) — `outbound` + `inbound` for the current ISO week.
- [ ] **Talk time**: total minutes this week, formatted as "5h 23m".
- [ ] **Avg duration**: average call length this week, formatted as "4m 12s".
- [ ] **PSTN spend**: total cost this month, formatted as "$12.45" (only shown if
      billing is enabled / `totalCost > 0`).

### Charts

- [ ] **Call volume over time**: area or bar chart (recharts `AreaChart` or
      `BarChart`) showing daily call count for the last 30 days. Split by
      direction (inbound = one color, outbound = another).
- [ ] **Talk time over time**: stacked area chart showing daily minutes.
- [ ] **Call outcome breakdown**: donut/pie chart — answered vs missed vs
      declined vs voicemail.
- [ ] **Spend over time**: area chart showing daily/weekly cost (only if billing
      is active).

### Top Contacts

- [ ] A ranked list of the 10 most-called/called-by contacts:
      - Avatar + name (from contacts store or raw number)
      - Call count badge
      - Total talk time
      - Quick-call button
- [ ] Tap a contact → filtered call history with just that contact.

### Time Period Selector

- [ ] Segmented control: "This week" | "This month" | "Last 30 days" | "All time"
- [ ] Changes the stats query range and re-renders charts/cards.

## Zustand Store

- [ ] New `analytics.store.ts` with:
      - `stats`, `loading`, `period` state
      - `fetchStats(period)` — calls `GET /api/g/stats/me?from=...&to=...`
      - Cache with TTL (5 minutes) — analytics don't need real-time updates.
- [ ] Add to `go-api.ts`: `goApi.stats.me(from, to)`.

## Navigation

- [ ] Add an **Analytics** icon/tab to the main nav (bar chart icon) — or place
      it as a header button in the Recents screen (less intrusive for a personal
      phone).
- [ ] The admin dashboard (`/admin`) stays separate — it's engine-level metrics.
      This is user-level.

## Guardrails / Edge Cases

- [ ] **Empty state**: new users with 0 calls → show a friendly empty state
      ("Make your first call to see analytics here").
- [ ] **Performance**: the stats query could be slow on large datasets. Add
      indices: `CREATE INDEX idx_calls_from_ext ON call_records(from_ext)`,
      `idx_calls_to_ext ON call_records(to_ext)`. For personal use (< 10k calls)
      it's instant.
- [ ] **Timezone**: display dates in the user's timezone. The Go API should accept
      a `tz` query param or use the user's saved timezone.
- [ ] **Privacy**: stats are per-user (JWT-scoped). No user can see another's
      analytics.
