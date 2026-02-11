-- Add columns to bookings table for recurring events
-- This migration adds support for Google Calendar-style recurring bookings

-- Add is_recurring flag
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

-- Add series ID to link recurring bookings together
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS recurrence_series_id UUID DEFAULT NULL;

-- Add index within the series (0 = first occurrence)
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS recurrence_index INTEGER DEFAULT NULL;

-- Add recurrence rule (stored as JSONB on the first booking of a series)
-- Structure: {
--   frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom',
--   interval: number (e.g., 2 for "every 2 weeks"),
--   weekdays: number[] (0-6, Sunday-Saturday, for weekly recurrence),
--   monthly_type: 'day_of_month' | 'day_of_week',
--   end_type: 'never' | 'on_date' | 'after_count',
--   end_date: string | null (ISO date),
--   end_count: number | null,
--   calculated_dates: string[] (array of ISO dates)
-- }
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS recurrence_rule JSONB DEFAULT NULL;

-- Create index on recurrence_series_id for efficient queries
CREATE INDEX IF NOT EXISTS idx_bookings_recurrence_series_id 
ON bookings(recurrence_series_id) 
WHERE recurrence_series_id IS NOT NULL;

-- Create index on is_recurring for filtering
CREATE INDEX IF NOT EXISTS idx_bookings_is_recurring 
ON bookings(is_recurring) 
WHERE is_recurring = TRUE;

-- Comment on columns for documentation
COMMENT ON COLUMN bookings.is_recurring IS 'Whether this booking is part of a recurring series';
COMMENT ON COLUMN bookings.recurrence_series_id IS 'UUID linking all bookings in the same recurring series';
COMMENT ON COLUMN bookings.recurrence_index IS 'Position of this booking within the recurring series (0-indexed)';
COMMENT ON COLUMN bookings.recurrence_rule IS 'JSON object containing the recurrence rule (only stored on first booking of series)';
