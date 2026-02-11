-- =============================================================================
-- Scout Bookings - Weekly Sessions Migration
-- =============================================================================
-- Adds weekly_sessions column to scout_huts for storing recurring group meetings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Add weekly_sessions column to scout_huts
-- -----------------------------------------------------------------------------

-- Weekly group sessions stored as JSONB
-- Format: { "squirrels": { "enabled": true, "day": "monday", "start_time": "16:00", "end_time": "17:00" }, ... }
ALTER TABLE public.scout_huts
    ADD COLUMN IF NOT EXISTS weekly_sessions jsonb DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN public.scout_huts.weekly_sessions IS 'Weekly scout group sessions as JSONB: { group: { enabled, day, start_time, end_time } }';
