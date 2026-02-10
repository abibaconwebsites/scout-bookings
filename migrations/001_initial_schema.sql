-- =============================================================================
-- Scout Bookings - Initial Schema Migration
-- =============================================================================
-- Production-ready PostgreSQL schema for Scout Bookings.
-- Extends Supabase auth.users with profiles, scout huts, and bookings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- Required for uuid_generate_v4() and other UUID utilities.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- user_profiles: extends Supabase auth.users with app-specific profile data.
-- One row per authenticated user; id matches auth.users(id).
CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text NOT NULL,
    phone text,
    stripe_customer_id text,
    subscription_status text NOT NULL DEFAULT 'trial',
    subscription_plan text NOT NULL DEFAULT 'basic',
    trial_ends_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_profiles IS 'Profile data for authenticated users; extends auth.users.';

-- scout_huts: huts owned by users that can be booked.
CREATE TABLE public.scout_huts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    address text,
    capacity integer,
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.scout_huts IS 'Scout huts owned by users; bookings reference these.';

-- bookings: reservations for a scout hut (event name, contact, time range).
CREATE TABLE public.bookings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    hut_id uuid NOT NULL REFERENCES public.scout_huts(id) ON DELETE CASCADE,
    contact_name text,
    contact_email text,
    contact_phone text,
    event_name text NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'confirmed',
    notes text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT bookings_time_range CHECK (end_time > start_time)
);

COMMENT ON TABLE public.bookings IS 'Bookings for scout huts; each booking belongs to one hut.';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
-- Foreign keys and frequently queried columns for performance.

CREATE INDEX idx_user_profiles_stripe_customer_id
    ON public.user_profiles(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX idx_user_profiles_subscription_status
    ON public.user_profiles(subscription_status);

CREATE INDEX idx_scout_huts_owner_id
    ON public.scout_huts(owner_id);

CREATE INDEX idx_scout_huts_is_active
    ON public.scout_huts(is_active)
    WHERE is_active = true;

CREATE INDEX idx_bookings_hut_id
    ON public.bookings(hut_id);

CREATE INDEX idx_bookings_start_time
    ON public.bookings(start_time);

CREATE INDEX idx_bookings_end_time
    ON public.bookings(end_time);

-- Composite index for common "hut's bookings in date range" queries.
CREATE INDEX idx_bookings_hut_id_time_range
    ON public.bookings(hut_id, start_time, end_time);

CREATE INDEX idx_bookings_status
    ON public.bookings(status);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
-- Single function used by all tables to set updated_at to NOW() on UPDATE.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS 'Trigger function: sets updated_at to NOW() on row update.';

-- Attach trigger to each table.
CREATE TRIGGER set_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_scout_huts_updated_at
    BEFORE UPDATE ON public.scout_huts
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------
-- Enable RLS on all tables; policies restrict access by auth.uid().

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_huts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- user_profiles: users can only read and update their own row.
CREATE POLICY user_profiles_select_own
    ON public.user_profiles
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY user_profiles_update_own
    ON public.user_profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Allow insert so new users can create their profile (e.g. from trigger or app).
CREATE POLICY user_profiles_insert_own
    ON public.user_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);

-- scout_huts: users can manage only huts they own.
CREATE POLICY scout_huts_select_own
    ON public.scout_huts
    FOR SELECT
    USING (
        owner_id = auth.uid()
    );

CREATE POLICY scout_huts_insert_own
    ON public.scout_huts
    FOR INSERT
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY scout_huts_update_own
    ON public.scout_huts
    FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY scout_huts_delete_own
    ON public.scout_huts
    FOR DELETE
    USING (owner_id = auth.uid());

-- bookings: users can manage bookings only for huts they own.
CREATE POLICY bookings_select_own_hut
    ON public.bookings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = bookings.hut_id AND h.owner_id = auth.uid()
        )
    );

CREATE POLICY bookings_insert_own_hut
    ON public.bookings
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = hut_id AND h.owner_id = auth.uid()
        )
    );

CREATE POLICY bookings_update_own_hut
    ON public.bookings
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = bookings.hut_id AND h.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = hut_id AND h.owner_id = auth.uid()
        )
    );

CREATE POLICY bookings_delete_own_hut
    ON public.bookings
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.scout_huts h
            WHERE h.id = hut_id AND h.owner_id = auth.uid()
        )
    );
