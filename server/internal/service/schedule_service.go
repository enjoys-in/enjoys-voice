package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
)

// exceptionDateLayout is the canonical YYYY-MM-DD calendar-date format accepted
// for business-hours exceptions.
const exceptionDateLayout = "2006-01-02"

// ErrScheduleInvalid is returned when a submitted window is malformed (400).
var ErrScheduleInvalid = errors.New("invalid schedule: day_of_week must be 0-6 and 0 <= start_minute < end_minute <= 1440")

// WindowInput is one open interval shared by business-hours and per-user
// availability payloads. Minutes are measured from midnight (0-1440).
type WindowInput struct {
	DayOfWeek   int   `json:"day_of_week"`
	StartMinute int   `json:"start_minute"`
	EndMinute   int   `json:"end_minute"`
	Enabled     *bool `json:"enabled,omitempty"`
}

// ExceptionInput is one calendar-date override of the weekly business hours.
// When ClosedAllDay the company is shut for the whole date; otherwise
// StartMinute/EndMinute define the only open window that day.
type ExceptionInput struct {
	Date         string `json:"date"`
	ClosedAllDay bool   `json:"closed_all_day"`
	StartMinute  *int   `json:"start_minute,omitempty"`
	EndMinute    *int   `json:"end_minute,omitempty"`
	Note         string `json:"note,omitempty"`
}

// BusinessHoursInput is the full upsert document for the global policy.
type BusinessHoursInput struct {
	Timezone   string           `json:"timezone"`
	Enabled    bool             `json:"enabled"`
	Windows    []WindowInput    `json:"windows"`
	Exceptions []ExceptionInput `json:"exceptions"`
}

// AvailabilityInput replaces a single user's availability windows.
type AvailabilityInput struct {
	Timezone string        `json:"timezone"`
	Windows  []WindowInput `json:"windows"`
}

type scheduleService struct {
	repo repository.ScheduleRepository
}

func NewScheduleService(repo repository.ScheduleRepository) ScheduleService {
	return &scheduleService{repo: repo}
}

func (s *scheduleService) GetBusinessHours(ctx context.Context) (*models.BusinessHoursPolicy, error) {
	policy, err := s.repo.GetBusinessHours(ctx)
	if err != nil {
		return nil, err
	}
	if policy == nil {
		// Represent "never configured" as a disabled, empty UTC policy so the UI
		// always has a stable shape to render.
		return &models.BusinessHoursPolicy{
			Timezone:   "UTC",
			Enabled:    false,
			Windows:    []models.BusinessHoursWindow{},
			Exceptions: []models.BusinessHoursException{},
		}, nil
	}
	return policy, nil
}

func (s *scheduleService) SaveBusinessHours(ctx context.Context, in *BusinessHoursInput) (*models.BusinessHoursPolicy, error) {
	if in == nil {
		return nil, ErrScheduleInvalid
	}
	tz := normalizeTimezone(in.Timezone)
	windows := make([]models.BusinessHoursWindow, 0, len(in.Windows))
	for _, w := range in.Windows {
		if !validWindow(w) {
			return nil, ErrScheduleInvalid
		}
		windows = append(windows, models.BusinessHoursWindow{
			DayOfWeek:   int16(w.DayOfWeek),
			StartMinute: int16(w.StartMinute),
			EndMinute:   int16(w.EndMinute),
		})
	}
	exceptions, err := buildExceptions(in.Exceptions)
	if err != nil {
		return nil, err
	}
	return s.repo.SaveBusinessHours(ctx, tz, in.Enabled, windows, exceptions)
}

// buildExceptions validates and maps the exception payload, rejecting malformed
// dates, out-of-bounds windows, and duplicate dates with ErrScheduleInvalid.
func buildExceptions(in []ExceptionInput) ([]models.BusinessHoursException, error) {
	exceptions := make([]models.BusinessHoursException, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, e := range in {
		date := strings.TrimSpace(e.Date)
		parsed, err := time.Parse(exceptionDateLayout, date)
		if err != nil {
			return nil, ErrScheduleInvalid
		}
		if seen[date] {
			return nil, ErrScheduleInvalid
		}
		seen[date] = true

		note := strings.TrimSpace(e.Note)
		if len(note) > 200 {
			note = note[:200]
		}
		ex := models.BusinessHoursException{
			Date:         models.DateOnly{Time: parsed},
			ClosedAllDay: e.ClosedAllDay,
			Note:         note,
		}
		if !e.ClosedAllDay {
			if e.StartMinute == nil || e.EndMinute == nil ||
				*e.StartMinute < 0 || *e.StartMinute > 1439 ||
				*e.EndMinute < 1 || *e.EndMinute > 1440 ||
				*e.StartMinute >= *e.EndMinute {
				return nil, ErrScheduleInvalid
			}
			start := int16(*e.StartMinute)
			end := int16(*e.EndMinute)
			ex.StartMinute = &start
			ex.EndMinute = &end
		}
		exceptions = append(exceptions, ex)
	}
	return exceptions, nil
}

func (s *scheduleService) ListAvailability(ctx context.Context, ext string) ([]models.UserAvailabilityWindow, error) {
	return s.repo.ListAvailability(ctx, ext)
}

func (s *scheduleService) SaveAvailability(ctx context.Context, ext string, in *AvailabilityInput) ([]models.UserAvailabilityWindow, error) {
	if in == nil {
		return nil, ErrScheduleInvalid
	}
	tz := normalizeTimezone(in.Timezone)
	windows := make([]models.UserAvailabilityWindow, 0, len(in.Windows))
	for _, w := range in.Windows {
		if !validWindow(w) {
			return nil, ErrScheduleInvalid
		}
		enabled := true
		if w.Enabled != nil {
			enabled = *w.Enabled
		}
		windows = append(windows, models.UserAvailabilityWindow{
			Extension:   ext,
			DayOfWeek:   int16(w.DayOfWeek),
			StartMinute: int16(w.StartMinute),
			EndMinute:   int16(w.EndMinute),
			Timezone:    tz,
			Enabled:     enabled,
		})
	}
	if err := s.repo.ReplaceAvailability(ctx, ext, windows); err != nil {
		return nil, err
	}
	return s.repo.ListAvailability(ctx, ext)
}

// validWindow enforces the same bounds as the SQL CHECK constraints so the API
// rejects bad input with a 400 rather than surfacing a database error.
func validWindow(w WindowInput) bool {
	if w.DayOfWeek < 0 || w.DayOfWeek > 6 {
		return false
	}
	if w.StartMinute < 0 || w.StartMinute > 1439 {
		return false
	}
	if w.EndMinute < 1 || w.EndMinute > 1440 {
		return false
	}
	return w.StartMinute < w.EndMinute
}

func normalizeTimezone(tz string) string {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		return "UTC"
	}
	return tz
}
