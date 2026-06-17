package database

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// RunSQLMigrations executes every *.sql file in dir (lexical order) against db,
// exactly once each, recording what it applied in a schema_migrations ledger.
//
// It complements gorm's AutoMigrate: AutoMigrate owns the table schema, while
// these files carry things AutoMigrate can't express — currently the seed test
// users. Each unapplied file runs inside a transaction and is then stamped in
// the ledger by name + content checksum, so:
//   - a file already recorded with the same checksum is skipped, so restarts
//     don't depend solely on every statement being hand-written idempotent;
//   - a file whose contents changed after being applied is rejected, surfacing
//     accidental edits to history instead of silently diverging;
//   - a half-applied file can't be recorded as done — the statements and the
//     ledger row commit together or not at all;
//   - a missing directory is treated as "nothing to apply".
func RunSQLMigrations(db *gorm.DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read migrations dir: %w", err)
	}

	if err := ensureMigrationsTable(db); err != nil {
		return err
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	for _, name := range files {
		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		checksum := sha256Hex(content)

		applied, prev, err := migrationState(db, name)
		if err != nil {
			return err
		}
		if applied {
			if prev != checksum {
				return fmt.Errorf(
					"migration %s changed after being applied (recorded %s, now %s); "+
						"migrations are immutable — add a new file instead of editing history",
					name, short(prev), short(checksum),
				)
			}
			continue // already applied, unchanged
		}

		stmts := splitStatements(string(content))
		if err := db.Transaction(func(tx *gorm.DB) error {
			for _, stmt := range stmts {
				if err := tx.Exec(stmt).Error; err != nil {
					return fmt.Errorf("exec %s: %w", name, err)
				}
			}
			return tx.Exec(
				"INSERT INTO schema_migrations (name, checksum) VALUES (?, ?) ON CONFLICT (name) DO NOTHING",
				name, checksum,
			).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

// ensureMigrationsTable creates the ledger that records which migration files
// have run. It is itself idempotent so it is safe on every startup.
func ensureMigrationsTable(db *gorm.DB) error {
	return db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name       TEXT PRIMARY KEY,
		checksum   TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`).Error
}

// migrationState reports whether name was already applied and, if so, the
// checksum recorded for it.
func migrationState(db *gorm.DB, name string) (applied bool, checksum string, err error) {
	var row struct{ Checksum string }
	res := db.Raw("SELECT checksum FROM schema_migrations WHERE name = ?", name).Scan(&row)
	if res.Error != nil {
		return false, "", fmt.Errorf("query schema_migrations: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return false, "", nil
	}
	return true, row.Checksum, nil
}

// splitStatements turns a SQL file into individual statements. It strips
// full-line "--" comments and splits on ";". This keeps the runner portable
// across the lib/pq and pgx drivers (the latter rejects multi-statement Exec).
// Our migration files contain only plain DDL/DML with no semicolons inside
// string literals or function bodies, so a simple split is safe here.
func splitStatements(sql string) []string {
	var b strings.Builder
	for _, line := range strings.Split(sql, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}

	var stmts []string
	for _, part := range strings.Split(b.String(), ";") {
		if strings.TrimSpace(part) != "" {
			stmts = append(stmts, part)
		}
	}
	return stmts
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// short trims a checksum to a readable prefix for error messages.
func short(s string) string {
	if len(s) > 12 {
		return s[:12]
	}
	return s
}
