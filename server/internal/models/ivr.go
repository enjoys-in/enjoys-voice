package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// JSONB is a PostgreSQL `jsonb` column backed by raw JSON bytes. It implements
// sql.Scanner / driver.Valuer so GORM can persist arbitrary JSON graphs, and
// json.Marshaler / json.Unmarshaler so it round-trips transparently in API
// payloads.
type JSONB json.RawMessage

func (j JSONB) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "null", nil
	}
	return string(j), nil
}

func (j *JSONB) Scan(src interface{}) error {
	if src == nil {
		*j = JSONB("null")
		return nil
	}
	switch v := src.(type) {
	case []byte:
		*j = append((*j)[0:0], v...)
		return nil
	case string:
		*j = append((*j)[0:0], []byte(v)...)
		return nil
	default:
		return errors.New("JSONB: unsupported scan type")
	}
}

// GormDataType tells GORM to use a jsonb column on migration.
func (JSONB) GormDataType() string { return "jsonb" }

func (j JSONB) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSONB) UnmarshalJSON(data []byte) error {
	if j == nil {
		return errors.New("JSONB: UnmarshalJSON on nil pointer")
	}
	*j = append((*j)[0:0], data...)
	return nil
}

// IvrFlow is one visual IVR "agent" built in the flow builder UI. The node/edge
// graph is stored verbatim as a jsonb column; `extension` is the entry DID.
type IvrFlow struct {
	ID        string    `gorm:"primaryKey;size:64" json:"id"`
	Name      string    `gorm:"size:200;not null" json:"name"`
	Extension string    `gorm:"uniqueIndex;size:20;not null" json:"extension"`
	Enabled   bool      `gorm:"default:true" json:"enabled"`
	Graph     JSONB     `gorm:"type:jsonb" json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (IvrFlow) TableName() string { return "ivr_flows" }
