-- Initial migration

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    extension VARCHAR(20) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    mobile VARCHAR(200) NOT NULL,
    password VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_extension ON users(extension);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);

CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extension VARCHAR(20) NOT NULL,
    sounds_enabled BOOLEAN DEFAULT TRUE,
    dtmf_enabled BOOLEAN DEFAULT TRUE,
    caller_tune VARCHAR(255) DEFAULT 'caller_tune.wav',
    ringtone VARCHAR(255) DEFAULT 'ringtone.wav',
    pstn_enabled BOOLEAN DEFAULT FALSE,
    pstn_mobile VARCHAR(20) DEFAULT '',
    pstn_country_code VARCHAR(5) DEFAULT '+91',
    recording_enabled BOOLEAN DEFAULT FALSE,
    voicemail_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_records (
    id SERIAL PRIMARY KEY,
    "from" VARCHAR(20) NOT NULL,
    "to" VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    duration INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocked_numbers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extension VARCHAR(20) NOT NULL,
    number VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(extension, number)
);

CREATE TABLE IF NOT EXISTS forwarding_rules (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extension VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL,
    target VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(extension, type)
);

CREATE TABLE IF NOT EXISTS sounds (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extension VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    path VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recordings (
    id SERIAL PRIMARY KEY,
    extension VARCHAR(20) NOT NULL,
    call_id VARCHAR(100),
    filename VARCHAR(255) NOT NULL,
    duration INTEGER DEFAULT 0,
    path VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voicemails (
    id SERIAL PRIMARY KEY,
    extension VARCHAR(20) NOT NULL,
    "from" VARCHAR(20) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    duration INTEGER DEFAULT 0,
    path VARCHAR(500) NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_call_records_from ON call_records("from");
CREATE INDEX IF NOT EXISTS idx_call_records_to ON call_records("to");
CREATE INDEX IF NOT EXISTS idx_blocked_numbers_ext ON blocked_numbers(extension);
CREATE INDEX IF NOT EXISTS idx_forwarding_rules_ext ON forwarding_rules(extension);
CREATE INDEX IF NOT EXISTS idx_sounds_ext ON sounds(extension);
CREATE INDEX IF NOT EXISTS idx_recordings_ext ON recordings(extension);
CREATE INDEX IF NOT EXISTS idx_voicemails_ext ON voicemails(extension);
CREATE INDEX IF NOT EXISTS idx_user_settings_ext ON user_settings(extension);
