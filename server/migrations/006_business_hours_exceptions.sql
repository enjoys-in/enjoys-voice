-- Business-hours one-off exceptions / holidays (phase 6)
--
-- A calendar-date override of the weekly business-hours schedule. When
-- closed_all_day the company is shut for the entire date (a holiday); otherwise
-- start_minute/end_minute define the ONLY open window that day (e.g. a half-day).
-- A matching exception takes precedence over the normal weekly windows. With no
-- exception for a date the weekly schedule applies as before (backward compatible).

CREATE TABLE IF NOT EXISTS business_hours_exceptions (
    id SERIAL PRIMARY KEY,
    policy_id INTEGER NOT NULL REFERENCES business_hours_policies(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    closed_all_day BOOLEAN NOT NULL DEFAULT TRUE,
    start_minute SMALLINT CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute SMALLINT CHECK (end_minute BETWEEN 1 AND 1440),
    note VARCHAR(200) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- A non-closed (special-hours) day must carry an ordered, present window.
    CHECK (
        closed_all_day
        OR (start_minute IS NOT NULL AND end_minute IS NOT NULL AND start_minute < end_minute)
    ),
    UNIQUE (policy_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_business_hours_exceptions_policy_date
    ON business_hours_exceptions(policy_id, exception_date);
