package database

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// RunSQLMigrations executes every *.sql file in dir (lexical order) against db.
//
// It complements gorm's AutoMigrate: AutoMigrate owns the table schema, while
// these files carry things AutoMigrate can't express — currently the seed test
// users. Every statement in the files is written to be idempotent (CREATE TABLE
// IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING), so this is safe to run on
// every startup. A missing directory is treated as "nothing to apply".
func RunSQLMigrations(db *gorm.DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read migrations dir: %w", err)
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
		for _, stmt := range splitStatements(string(content)) {
			if err := db.Exec(stmt).Error; err != nil {
				return fmt.Errorf("exec %s: %w", name, err)
			}
		}
	}
	return nil
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
