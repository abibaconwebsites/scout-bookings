-- =============================================================================
-- Scout Bookings - Huts Availability Migration
-- =============================================================================
-- Adds structured address fields, URL slug, and availability schedule to scout_huts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Add new columns to scout_huts
-- -----------------------------------------------------------------------------

-- URL-friendly slug for public booking pages
ALTER TABLE public.scout_huts
    ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Structured address fields (replacing single address column)
ALTER TABLE public.scout_huts
    ADD COLUMN IF NOT EXISTS address_line1 text,
    ADD COLUMN IF NOT EXISTS address_line2 text,
    ADD COLUMN IF NOT EXISTS city text,
    ADD COLUMN IF NOT EXISTS postcode text;

-- Availability schedule stored as JSONB
-- Format: { "monday": { "enabled": true, "start_time": "09:00", "end_time": "21:00" }, ... }
ALTER TABLE public.scout_huts
    ADD COLUMN IF NOT EXISTS availability jsonb DEFAULT '{}'::jsonb;

-- Weekly group sessions stored as JSONB
-- Format: { "squirrels": { "enabled": true, "day": "monday", "start_time": "16:00", "end_time": "17:00" }, ... }
ALTER TABLE public.scout_huts
    ADD COLUMN IF NOT EXISTS weekly_sessions jsonb DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- Add unique constraint for one hut per user
-- -----------------------------------------------------------------------------
-- Each user can only have one scout hut (for the basic plan)

ALTER TABLE public.scout_huts
    ADD CONSTRAINT scout_huts_owner_id_unique UNIQUE (owner_id);

-- -----------------------------------------------------------------------------
-- Indexes for new columns
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_scout_huts_slug
    ON public.scout_huts(slug)
    WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scout_huts_postcode
    ON public.scout_huts(postcode)
    WHERE postcode IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Update RLS policies to allow public read access for booking pages
-- -----------------------------------------------------------------------------

-- Allow anyone to view active huts by slug (for public booking pages)
CREATE POLICY scout_huts_select_public_by_slug
    ON public.scout_huts
    FOR SELECT
    USING (
        is_active = true AND slug IS NOT NULL
    );

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

COMMENT ON COLUMN public.scout_huts.slug IS 'URL-friendly identifier for public booking pages';
COMMENT ON COLUMN public.scout_huts.address_line1 IS 'Street address';
COMMENT ON COLUMN public.scout_huts.address_line2 IS 'Additional address info (apt, suite, etc.)';
COMMENT ON COLUMN public.scout_huts.city IS 'City or town';
COMMENT ON COLUMN public.scout_huts.postcode IS 'Postal code';
COMMENT ON COLUMN public.scout_huts.availability IS 'Weekly availability schedule as JSONB: { day: { enabled, start_time, end_time } }';
COMMENT ON COLUMN public.scout_huts.weekly_sessions IS 'Weekly scout group sessions as JSONB: { group: { enabled, day, start_time, end_time } }';
