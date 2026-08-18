-- Widen call_records from/to columns from varchar(20) to varchar(50)
-- to accommodate UUID-style caller IDs and long international numbers.
ALTER TABLE call_records ALTER COLUMN "from" TYPE VARCHAR(50);
ALTER TABLE call_records ALTER COLUMN "to" TYPE VARCHAR(50);
