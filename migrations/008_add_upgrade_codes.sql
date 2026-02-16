-- Migration: 009_add_upgrade_codes
-- Description: Add upgrade codes table for Pro subscription upgrades
-- Date: 2026-02-16

-- Create upgrade codes table
CREATE TABLE IF NOT EXISTS upgrade_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    subscription_plan VARCHAR(50) DEFAULT 'pro',
    subscription_duration_days INTEGER DEFAULT 365,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Create redemptions table to track who used which code
CREATE TABLE IF NOT EXISTS upgrade_code_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id UUID REFERENCES upgrade_codes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(code_id, user_id)
);

-- Add upgrade tracking columns to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS upgrade_code_used VARCHAR(50);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

-- Enable RLS on upgrade_codes
ALTER TABLE upgrade_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can check if a code exists (for validation)
CREATE POLICY "Anyone can validate codes" ON upgrade_codes
    FOR SELECT USING (true);

-- Policy: Only admins can insert/update/delete codes (you'd manage this via Supabase dashboard)

-- Enable RLS on redemptions
ALTER TABLE upgrade_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see their own redemptions
CREATE POLICY "Users can view own redemptions" ON upgrade_code_redemptions
    FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can redeem codes
CREATE POLICY "Users can redeem codes" ON upgrade_code_redemptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create function to redeem an upgrade code
CREATE OR REPLACE FUNCTION redeem_upgrade_code(p_code VARCHAR)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code_record upgrade_codes%ROWTYPE;
    v_user_id UUID;
    v_result JSON;
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    -- Find the code (case-insensitive)
    SELECT * INTO v_code_record
    FROM upgrade_codes
    WHERE UPPER(code) = UPPER(p_code)
    AND is_active = true;
    
    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid upgrade code');
    END IF;
    
    -- Check if expired
    IF v_code_record.expires_at IS NOT NULL AND v_code_record.expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'error', 'This code has expired');
    END IF;
    
    -- Check if max uses reached
    IF v_code_record.max_uses IS NOT NULL AND v_code_record.current_uses >= v_code_record.max_uses THEN
        RETURN json_build_object('success', false, 'error', 'This code has reached its maximum uses');
    END IF;
    
    -- Check if user already redeemed this code
    IF EXISTS (SELECT 1 FROM upgrade_code_redemptions WHERE code_id = v_code_record.id AND user_id = v_user_id) THEN
        RETURN json_build_object('success', false, 'error', 'You have already used this code');
    END IF;
    
    -- Check if user already has an active pro subscription
    IF EXISTS (SELECT 1 FROM user_profiles WHERE id = v_user_id AND subscription_status = 'pro' AND (subscription_ends_at IS NULL OR subscription_ends_at > NOW())) THEN
        RETURN json_build_object('success', false, 'error', 'You already have an active Pro subscription');
    END IF;
    
    -- Redeem the code
    -- 1. Insert redemption record
    INSERT INTO upgrade_code_redemptions (code_id, user_id)
    VALUES (v_code_record.id, v_user_id);
    
    -- 2. Increment usage count
    UPDATE upgrade_codes
    SET current_uses = current_uses + 1
    WHERE id = v_code_record.id;
    
    -- 3. Update user profile with pro subscription
    UPDATE user_profiles
    SET 
        subscription_status = v_code_record.subscription_plan,
        subscription_plan = v_code_record.subscription_plan,
        upgraded_at = NOW(),
        upgrade_code_used = v_code_record.code,
        subscription_ends_at = NOW() + (v_code_record.subscription_duration_days || ' days')::INTERVAL
    WHERE id = v_user_id;
    
    RETURN json_build_object(
        'success', true, 
        'plan', v_code_record.subscription_plan,
        'expires_at', (NOW() + (v_code_record.subscription_duration_days || ' days')::INTERVAL)::TEXT
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION redeem_upgrade_code(VARCHAR) TO authenticated;
