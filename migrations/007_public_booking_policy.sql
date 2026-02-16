-- =============================================================================
-- Scout Bookings - Public Booking Policy Migration
-- =============================================================================
-- Allows anonymous users to submit booking requests (pending status) via the
-- public booking page. The hut owner can then approve or decline these requests.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Allow public read access to active huts (for public booking page)
-- -----------------------------------------------------------------------------
-- Anonymous users need to be able to view hut details on the public booking page.

CREATE POLICY scout_huts_select_public_active
    ON public.scout_huts
    FOR SELECT
    USING (is_active = true);

-- -----------------------------------------------------------------------------
-- Allow anonymous users to insert pending bookings
-- -----------------------------------------------------------------------------
-- Public booking requests must:
-- 1. Be for an active hut
-- 2. Have status = 'pending'
-- This allows the public booking form to work without authentication.

CREATE POLICY bookings_insert_public_pending
    ON public.bookings
    FOR INSERT
    WITH CHECK (
        -- Must be a pending booking
        status = 'pending'
        AND
        -- Must be for an active hut
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = hut_id AND h.is_active = true
        )
    );

-- -----------------------------------------------------------------------------
-- Allow anonymous users to read bookings for availability checking
-- -----------------------------------------------------------------------------
-- Public users need to see when slots are unavailable (but not booking details).
-- This policy allows reading only the time fields for active huts.
-- Note: The application should only expose start_time/end_time, not contact info.

CREATE POLICY bookings_select_public_times
    ON public.bookings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = bookings.hut_id AND h.is_active = true
        )
    );
