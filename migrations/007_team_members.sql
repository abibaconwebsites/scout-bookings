-- Migration: 007_team_members.sql
-- Purpose: Enable team collaboration for Scout Hut management
--
-- This migration creates the infrastructure for:
-- 1. Inviting team members to collaborate on hut management
-- 2. Managing team member roles and permissions
-- 3. Tracking invitation status and expiry
--
-- TEAM ROLES:
-- - 'owner': Full access, can manage team, delete hut (one per hut, set in scout_huts.owner_id)
-- - 'admin': Can manage bookings, edit hut settings, invite members (cannot delete hut)
-- - 'member': Can view and create bookings (cannot edit hut settings or manage team)
-- - 'viewer': Read-only access to bookings and calendar
--
-- INVITATION FLOW:
-- 1. Owner/Admin sends invitation via email
-- 2. Invitation stored with unique token and expiry (7 days)
-- 3. Invitee clicks link, creates account if needed
-- 4. On acceptance, team_members record created, invitation marked accepted
-- 5. Invitee can now access the hut based on their role

-- ============================================================================
-- TABLE 1: team_members
-- Links users to huts with specific roles
-- ============================================================================
-- This table defines which users have access to which huts and their permission level.
-- The hut owner is NOT stored here (they're in scout_huts.owner_id).
-- Only invited team members are stored in this table.

CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- The hut this team membership is for
    hut_id UUID NOT NULL REFERENCES scout_huts(id) ON DELETE CASCADE,
    
    -- The user who is a team member
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Role determines permissions: admin, member, viewer
    -- (owner is determined by scout_huts.owner_id, not stored here)
    role TEXT NOT NULL DEFAULT 'member' 
        CHECK (role IN ('admin', 'member', 'viewer')),
    
    -- Who invited this team member (for audit trail)
    invited_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    
    -- When the invitation was accepted and membership began
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each user can only be a team member once per hut
    CONSTRAINT team_members_hut_user_unique UNIQUE (hut_id, user_id)
);

COMMENT ON TABLE team_members IS 'Team members who have been granted access to a hut. Owners are stored in scout_huts.owner_id.';
COMMENT ON COLUMN team_members.role IS 'Permission level: admin (full access except delete), member (bookings only), viewer (read-only)';
COMMENT ON COLUMN team_members.invited_by IS 'The user who sent the invitation (owner or admin)';

-- ============================================================================
-- TABLE 2: team_invitations
-- Pending invitations that haven't been accepted yet
-- ============================================================================
-- Invitations are sent via email and contain a unique token.
-- Once accepted, a team_members record is created and the invitation is marked as accepted.
-- Invitations expire after 7 days if not accepted.

CREATE TABLE IF NOT EXISTS team_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- The hut this invitation is for
    hut_id UUID NOT NULL REFERENCES scout_huts(id) ON DELETE CASCADE,
    
    -- Email address of the invitee
    email TEXT NOT NULL,
    
    -- Role that will be assigned upon acceptance
    role TEXT NOT NULL DEFAULT 'member' 
        CHECK (role IN ('admin', 'member', 'viewer')),
    
    -- Unique token for the invitation link
    -- Format: URL-safe random string
    token TEXT NOT NULL UNIQUE,
    
    -- Who sent this invitation
    invited_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Invitation status
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    
    -- When the invitation expires (default 7 days from creation)
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    
    -- When the invitation was accepted (NULL if not yet accepted)
    accepted_at TIMESTAMP WITH TIME ZONE,
    
    -- The user who accepted (NULL if not yet accepted, links to team_members.user_id)
    accepted_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE team_invitations IS 'Pending team invitations. Once accepted, creates a team_members record.';
COMMENT ON COLUMN team_invitations.token IS 'Unique URL-safe token for invitation link';
COMMENT ON COLUMN team_invitations.status IS 'pending = awaiting response, accepted = joined team, expired = past expiry, revoked = cancelled by admin';
COMMENT ON COLUMN team_invitations.expires_at IS 'Invitation expires 7 days after creation if not accepted';

-- ============================================================================
-- INDEXES
-- Optimize common query patterns for team operations
-- ============================================================================

-- team_members: Fast lookup by hut (list all team members)
CREATE INDEX IF NOT EXISTS idx_team_members_hut_id 
    ON team_members(hut_id);

-- team_members: Fast lookup by user (list all huts user has access to)
CREATE INDEX IF NOT EXISTS idx_team_members_user_id 
    ON team_members(user_id);

-- team_members: Fast lookup by hut and role (permission checks)
CREATE INDEX IF NOT EXISTS idx_team_members_hut_role 
    ON team_members(hut_id, role);

-- team_invitations: Fast lookup by hut (list pending invitations)
CREATE INDEX IF NOT EXISTS idx_team_invitations_hut_id 
    ON team_invitations(hut_id);

-- team_invitations: Fast lookup by email (check if already invited)
CREATE INDEX IF NOT EXISTS idx_team_invitations_email 
    ON team_invitations(email);

-- team_invitations: Fast lookup by token (invitation acceptance)
CREATE INDEX IF NOT EXISTS idx_team_invitations_token 
    ON team_invitations(token);

-- team_invitations: Fast lookup of pending invitations by hut
CREATE INDEX IF NOT EXISTS idx_team_invitations_hut_pending 
    ON team_invitations(hut_id, status) 
    WHERE status = 'pending';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Ensure users can only access appropriate data
-- ============================================================================

-- Enable RLS on team_members
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Users can view team members for huts they own or are a member of
CREATE POLICY team_members_select ON team_members
    FOR SELECT
    USING (
        -- User owns the hut
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_members.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        -- User is a team member of the hut
        user_id = auth.uid()
        OR
        -- User is an admin of the hut (can see other members)
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_members.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    );

-- Only owners and admins can add team members
CREATE POLICY team_members_insert ON team_members
    FOR INSERT
    WITH CHECK (
        -- User owns the hut
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_members.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        -- User is an admin of the hut
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_members.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    );

-- Only owners and admins can update team members (change roles)
CREATE POLICY team_members_update ON team_members
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_members.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_members.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_members.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_members.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    );

-- Owners and admins can remove team members, members can remove themselves
CREATE POLICY team_members_delete ON team_members
    FOR DELETE
    USING (
        -- User owns the hut
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_members.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        -- User is an admin of the hut
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_members.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
        OR
        -- User is removing themselves
        user_id = auth.uid()
    );

-- Enable RLS on team_invitations
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Users can view invitations for huts they own/admin, or invitations sent to their email
CREATE POLICY team_invitations_select ON team_invitations
    FOR SELECT
    USING (
        -- User owns the hut
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_invitations.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        -- User is an admin of the hut
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_invitations.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
        OR
        -- Invitation is for the current user's email (for acceptance)
        email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- Only owners and admins can create invitations
CREATE POLICY team_invitations_insert ON team_invitations
    FOR INSERT
    WITH CHECK (
        -- User owns the hut
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_invitations.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        -- User is an admin of the hut
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_invitations.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    );

-- Owners and admins can update invitations (revoke), invitees can accept
CREATE POLICY team_invitations_update ON team_invitations
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_invitations.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_invitations.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
        OR
        email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_invitations.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_invitations.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
        OR
        email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- Only owners and admins can delete invitations
CREATE POLICY team_invitations_delete ON team_invitations
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts 
            WHERE scout_huts.id = team_invitations.hut_id 
            AND scout_huts.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = team_invitations.hut_id
            AND tm.user_id = auth.uid()
            AND tm.role = 'admin'
        )
    );

-- ============================================================================
-- UPDATE EXISTING RLS POLICIES
-- Allow team members to access huts and bookings based on their role
-- ============================================================================

-- Drop existing policies that only allow owner access
DROP POLICY IF EXISTS scout_huts_select_own ON scout_huts;
DROP POLICY IF EXISTS bookings_select_own_hut ON bookings;
DROP POLICY IF EXISTS bookings_insert_own_hut ON bookings;
DROP POLICY IF EXISTS bookings_update_own_hut ON bookings;
DROP POLICY IF EXISTS bookings_delete_own_hut ON bookings;

-- scout_huts: Allow owners and team members to view
CREATE POLICY scout_huts_select_own_or_team ON scout_huts
    FOR SELECT
    USING (
        owner_id = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM team_members tm
            WHERE tm.hut_id = scout_huts.id
            AND tm.user_id = auth.uid()
        )
    );

-- bookings: Allow owners and team members to view
CREATE POLICY bookings_select_own_or_team ON bookings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts h
            WHERE h.id = bookings.hut_id 
            AND (
                h.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM team_members tm
                    WHERE tm.hut_id = h.id
                    AND tm.user_id = auth.uid()
                )
            )
        )
    );

-- bookings: Allow owners, admins, and members to create bookings
CREATE POLICY bookings_insert_own_or_team ON bookings
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts h
            WHERE h.id = hut_id 
            AND (
                h.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM team_members tm
                    WHERE tm.hut_id = h.id
                    AND tm.user_id = auth.uid()
                    AND tm.role IN ('admin', 'member')
                )
            )
        )
    );

-- bookings: Allow owners, admins, and members to update bookings
CREATE POLICY bookings_update_own_or_team ON bookings
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts h
            WHERE h.id = bookings.hut_id 
            AND (
                h.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM team_members tm
                    WHERE tm.hut_id = h.id
                    AND tm.user_id = auth.uid()
                    AND tm.role IN ('admin', 'member')
                )
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_huts h
            WHERE h.id = hut_id 
            AND (
                h.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM team_members tm
                    WHERE tm.hut_id = h.id
                    AND tm.user_id = auth.uid()
                    AND tm.role IN ('admin', 'member')
                )
            )
        )
    );

-- bookings: Allow owners and admins to delete bookings
CREATE POLICY bookings_delete_own_or_team ON bookings
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM scout_huts h
            WHERE h.id = bookings.hut_id 
            AND (
                h.owner_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM team_members tm
                    WHERE tm.hut_id = h.id
                    AND tm.user_id = auth.uid()
                    AND tm.role = 'admin'
                )
            )
        )
    );

-- ============================================================================
-- TRIGGERS
-- Automatically update timestamps
-- ============================================================================

-- Trigger: Auto-update updated_at on team_members
DROP TRIGGER IF EXISTS trigger_team_members_updated_at ON team_members;
CREATE TRIGGER trigger_team_members_updated_at
    BEFORE UPDATE ON team_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Auto-update updated_at on team_invitations
DROP TRIGGER IF EXISTS trigger_team_invitations_updated_at ON team_invitations;
CREATE TRIGGER trigger_team_invitations_updated_at
    BEFORE UPDATE ON team_invitations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTION: Generate invitation token
-- ============================================================================
-- Generates a URL-safe random token for invitation links

CREATE OR REPLACE FUNCTION generate_invitation_token()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    token TEXT;
BEGIN
    -- Generate a random 32-character URL-safe token
    token := encode(gen_random_bytes(24), 'base64');
    -- Make it URL-safe by replacing + and / with - and _
    token := replace(replace(token, '+', '-'), '/', '_');
    -- Remove any trailing = padding
    token := rtrim(token, '=');
    RETURN token;
END;
$$;

COMMENT ON FUNCTION generate_invitation_token() IS 'Generates a URL-safe random token for team invitations';

-- ============================================================================
-- HELPER FUNCTION: Check user role for a hut
-- ============================================================================
-- Returns the user's role for a given hut (owner, admin, member, viewer, or NULL)

CREATE OR REPLACE FUNCTION get_user_hut_role(p_user_id UUID, p_hut_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role TEXT;
BEGIN
    -- Check if user is owner
    IF EXISTS (SELECT 1 FROM scout_huts WHERE id = p_hut_id AND owner_id = p_user_id) THEN
        RETURN 'owner';
    END IF;
    
    -- Check team_members for role
    SELECT role INTO v_role
    FROM team_members
    WHERE hut_id = p_hut_id AND user_id = p_user_id;
    
    RETURN v_role; -- Returns NULL if not found
END;
$$;

COMMENT ON FUNCTION get_user_hut_role(UUID, UUID) IS 'Returns the user role for a hut: owner, admin, member, viewer, or NULL if no access';

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- This migration enables team collaboration with:
--
-- NEW TABLES:
-- - team_members: Links users to huts with roles (admin, member, viewer)
-- - team_invitations: Pending invitations with tokens and expiry
--
-- SECURITY:
-- - RLS enabled on both new tables
-- - Updated RLS on scout_huts and bookings to allow team member access
-- - Role-based permissions: owner > admin > member > viewer
--
-- HELPER FUNCTIONS:
-- - generate_invitation_token(): Creates URL-safe tokens
-- - get_user_hut_role(): Returns user's role for a hut
--
-- INDEXES:
-- - Optimized for common team query patterns
--
-- TRIGGERS:
-- - Auto-update timestamps on modification
