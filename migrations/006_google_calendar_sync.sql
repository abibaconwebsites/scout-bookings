-- Migration: 006_google_calendar_sync.sql
-- Purpose: Enable two-way Google Calendar synchronization for Scout Hut bookings
--
-- This migration creates the infrastructure for:
-- 1. Storing OAuth tokens for Google Calendar API access
-- 2. Tracking synced events between Google Calendar and Scout Bookings
-- 3. Configuring sync settings per hut
--
-- TWO-WAY SYNC EXPLANATION:
-- - 'google_to_scout': Events created in Google Calendar are imported as blocked times
--   in Scout Bookings. This prevents double-booking when the hut is used for other purposes.
-- - 'scout_to_google': Bookings made in Scout Bookings are exported to Google Calendar
--   for visibility and to block the time in the calendar.
-- - 'both': Full two-way sync - changes in either system are reflected in the other.
--
-- SYNC FLOW:
-- 1. User connects their Google account (OAuth tokens stored in calendar_tokens)
-- 2. User configures which Google Calendar to sync with each hut
-- 3. Periodic sync job compares events and creates/updates/deletes as needed
-- 4. synced_events table tracks the relationship between Google events and bookings

-- ============================================================================
-- TABLE 1: calendar_tokens
-- Stores Google OAuth tokens for each user
-- ============================================================================
-- This table holds the OAuth 2.0 credentials needed to access Google Calendar API
-- on behalf of each user. Tokens are encrypted at rest by Supabase.
-- The refresh_token is used to obtain new access_tokens when they expire.

CREATE TABLE IF NOT EXISTS calendar_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- The user who authorized Google Calendar access
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- OAuth 2.0 access token (short-lived, typically 1 hour)
    access_token TEXT NOT NULL,
    
    -- OAuth 2.0 refresh token (long-lived, used to get new access tokens)
    refresh_token TEXT NOT NULL,
    
    -- When the access_token expires (used to determine when to refresh)
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each user can only have one set of tokens
    CONSTRAINT calendar_tokens_user_unique UNIQUE (user_id)
);

COMMENT ON TABLE calendar_tokens IS 'Stores Google OAuth 2.0 tokens for Calendar API access. Each user has one token set.';
COMMENT ON COLUMN calendar_tokens.access_token IS 'Short-lived OAuth access token (typically expires in 1 hour)';
COMMENT ON COLUMN calendar_tokens.refresh_token IS 'Long-lived refresh token used to obtain new access tokens';
COMMENT ON COLUMN calendar_tokens.token_expires_at IS 'Timestamp when access_token expires; refresh before this time';

-- ============================================================================
-- TABLE 2: synced_events
-- Tracks the relationship between Google Calendar events and Scout Bookings
-- ============================================================================
-- This table maintains the mapping between events in both systems.
-- It enables:
-- - Detecting which events have already been synced
-- - Updating existing events rather than creating duplicates
-- - Cleaning up when events are deleted in either system
-- - Tracking sync history and debugging sync issues

CREATE TABLE IF NOT EXISTS synced_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Which hut this synced event belongs to
    hut_id UUID NOT NULL REFERENCES scout_huts(id) ON DELETE CASCADE,
    
    -- The Google Calendar event ID (unique within a calendar)
    google_event_id TEXT NOT NULL,
    
    -- Link to the Scout Booking (NULL for google_to_scout events that block time)
    -- When event_type is 'scout_to_google', this links to the source booking
    -- When event_type is 'google_to_scout', this may link to a generated blocking booking
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    
    -- Direction of sync that created this record:
    -- 'google_to_scout': Event originated in Google Calendar, imported to Scout
    -- 'scout_to_google': Booking originated in Scout, exported to Google Calendar
    event_type TEXT NOT NULL CHECK (event_type IN ('google_to_scout', 'scout_to_google')),
    
    -- Event timing (stored for quick conflict detection without API calls)
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Event title (cached for display purposes)
    title TEXT,
    
    -- When this event was last synchronized
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- When the sync record was created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate sync records for the same Google event on the same hut
    CONSTRAINT synced_events_hut_google_unique UNIQUE (hut_id, google_event_id)
);

COMMENT ON TABLE synced_events IS 'Tracks synchronized events between Google Calendar and Scout Bookings for two-way sync';
COMMENT ON COLUMN synced_events.event_type IS 'Direction: google_to_scout = imported from Google, scout_to_google = exported to Google';
COMMENT ON COLUMN synced_events.google_event_id IS 'Unique event ID from Google Calendar API';
COMMENT ON COLUMN synced_events.booking_id IS 'Associated Scout booking (source for exports, generated blocking record for imports)';
COMMENT ON COLUMN synced_events.last_synced_at IS 'Last time this event was checked/updated during sync';

-- ============================================================================
-- TABLE UPDATES: scout_huts
-- Add Google Calendar sync configuration columns
-- ============================================================================
-- These columns allow per-hut configuration of calendar sync behavior

ALTER TABLE scout_huts
    -- The Google Calendar ID to sync with (looks like an email address)
    -- Example: 'primary' for main calendar or 'abc123@group.calendar.google.com'
    ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
    
    -- Master switch to enable/disable sync for this hut
    ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT false,
    
    -- Sync direction configuration:
    -- 'both': Full two-way sync (recommended for most use cases)
    -- 'from_google': Only import Google events to Scout (read-only from Google)
    -- 'to_google': Only export Scout bookings to Google (write-only to Google)
    ADD COLUMN IF NOT EXISTS sync_direction TEXT DEFAULT 'both' 
        CHECK (sync_direction IN ('both', 'from_google', 'to_google')),
    
    -- Timestamp of last successful sync (for monitoring and debugging)
    ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN scout_huts.google_calendar_id IS 'Google Calendar ID to sync with (e.g., primary or calendar-specific ID)';
COMMENT ON COLUMN scout_huts.sync_enabled IS 'Master switch to enable/disable calendar sync for this hut';
COMMENT ON COLUMN scout_huts.sync_direction IS 'Sync mode: both (two-way), from_google (import only), to_google (export only)';
COMMENT ON COLUMN scout_huts.last_sync_at IS 'Timestamp of last successful sync operation';

-- ============================================================================
-- INDEXES
-- Optimize common query patterns for sync operations
-- ============================================================================

-- calendar_tokens: Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user_id 
    ON calendar_tokens(user_id);

-- synced_events: Fast lookup by hut
CREATE INDEX IF NOT EXISTS idx_synced_events_hut_id 
    ON synced_events(hut_id);

-- synced_events: Fast lookup by Google event ID (for deduplication)
CREATE INDEX IF NOT EXISTS idx_synced_events_google_event_id 
    ON synced_events(google_event_id);

-- synced_events: Fast lookup by hut and event type (for directional sync queries)
CREATE INDEX IF NOT EXISTS idx_synced_events_hut_event_type 
    ON synced_events(hut_id, event_type);

-- synced_events: Fast lookup by booking (for cascade operations)
CREATE INDEX IF NOT EXISTS idx_synced_events_booking_id 
    ON synced_events(booking_id);

-- scout_huts: Fast lookup of huts with calendar sync enabled
CREATE INDEX IF NOT EXISTS idx_scout_huts_google_calendar_id 
    ON scout_huts(google_calendar_id) 
    WHERE google_calendar_id IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Ensure users can only access their own data
-- ============================================================================

-- Enable RLS on calendar_tokens
ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only view their own tokens
CREATE POLICY calendar_tokens_select_own ON calendar_tokens
    FOR SELECT
    USING (user_id = auth.uid());

-- Users can only insert their own tokens
CREATE POLICY calendar_tokens_insert_own ON calendar_tokens
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users can only update their own tokens
CREATE POLICY calendar_tokens_update_own ON calendar_tokens
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users can only delete their own tokens
CREATE POLICY calendar_tokens_delete_own ON calendar_tokens
    FOR DELETE
    USING (user_id = auth.uid());

-- Enable RLS on synced_events
ALTER TABLE synced_events ENABLE ROW LEVEL SECURITY;

-- Users can only view synced events for huts they own
CREATE POLICY synced_events_select_own ON synced_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = synced_events.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
    );

-- Users can only insert synced events for huts they own
CREATE POLICY synced_events_insert_own ON synced_events
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = synced_events.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
    );

-- Users can only update synced events for huts they own
CREATE POLICY synced_events_update_own ON synced_events
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = synced_events.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = synced_events.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
    );

-- Users can only delete synced events for huts they own
CREATE POLICY synced_events_delete_own ON synced_events
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = synced_events.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
    );

-- ============================================================================
-- TRIGGERS
-- Automatically update timestamps
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update the last_synced_at timestamp
CREATE OR REPLACE FUNCTION update_last_synced_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_synced_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update updated_at on calendar_tokens
DROP TRIGGER IF EXISTS trigger_calendar_tokens_updated_at ON calendar_tokens;
CREATE TRIGGER trigger_calendar_tokens_updated_at
    BEFORE UPDATE ON calendar_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Auto-update last_synced_at on synced_events
DROP TRIGGER IF EXISTS trigger_synced_events_last_synced_at ON synced_events;
CREATE TRIGGER trigger_synced_events_last_synced_at
    BEFORE UPDATE ON synced_events
    FOR EACH ROW
    EXECUTE FUNCTION update_last_synced_at_column();

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration enables Google Calendar two-way sync with:
--
-- NEW TABLES:
-- - calendar_tokens: OAuth credentials per user
-- - synced_events: Event mapping between systems
--
-- UPDATED TABLES:
-- - scout_huts: Added sync configuration columns
--
-- SECURITY:
-- - RLS enabled on both new tables
-- - Users can only access their own tokens
-- - Users can only access synced events for huts they own
--
-- INDEXES:
-- - Optimized for common sync query patterns
--
-- TRIGGERS:
-- - Auto-update timestamps on modification
