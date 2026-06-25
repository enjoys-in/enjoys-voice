-- Routing availability and business-hours foundation (phase 2)

CREATE TABLE IF NOT EXISTS business_hours_policies (
    id SERIAL PRIMARY KEY,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_hours_windows (
    id SERIAL PRIMARY KEY,
    policy_id INTEGER NOT NULL REFERENCES business_hours_policies(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (start_minute < end_minute),
    UNIQUE (policy_id, day_of_week, start_minute, end_minute)
);

CREATE INDEX IF NOT EXISTS idx_business_hours_windows_policy
    ON business_hours_windows(policy_id, day_of_week, start_minute);

CREATE TABLE IF NOT EXISTS user_availability_windows (
    id SERIAL PRIMARY KEY,
    extension VARCHAR(20) NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (start_minute < end_minute),
    UNIQUE (extension, day_of_week, start_minute, end_minute)
);

CREATE INDEX IF NOT EXISTS idx_user_availability_extension
    ON user_availability_windows(extension, day_of_week, start_minute);
