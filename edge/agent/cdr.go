package main

import (
	"encoding/csv"
	"strconv"
	"strings"
)

// parseCDRLine maps the default mod_cdr_csv template (best-effort) and keeps the
// raw line so central can re-parse if its template differs.
//
// Default a-leg template field order:
//
//	0 caller_id_name   1 caller_id_number  2 destination_number  3 context
//	4 start_stamp      5 answer_stamp      6 end_stamp           7 duration
//	8 billsec          9 hangup_cause      10 uuid               ...
func parseCDRLine(line string) CDRRow {
	row := CDRRow{Raw: line}
	r := csv.NewReader(strings.NewReader(line))
	r.FieldsPerRecord = -1
	fields, err := r.Read()
	if err != nil {
		return row
	}
	at := func(i int) string {
		if i < len(fields) {
			return fields[i]
		}
		return ""
	}
	row.CallerIDName = at(0)
	row.CallerIDNumber = at(1)
	row.Destination = at(2)
	row.StartStamp = at(4)
	row.EndStamp = at(6)
	if v, err := strconv.Atoi(at(7)); err == nil {
		row.Duration = v
	}
	if v, err := strconv.Atoi(at(8)); err == nil {
		row.Billsec = v
	}
	row.HangupCause = at(9)
	row.UUID = at(10)
	return row
}
