-- Migration: 008_upgrade_codes
-- Description: Create upgrade_codes table for Pro subscription upgrades
-- Date: 2026-02-16

-- Create upgrade_codes table
CREATE TABLE IF NOT EXISTS upgrade_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id)
);

-- Add index for faster code lookups
CREATE INDEX IF NOT EXISTS idx_upgrade_codes_code ON upgrade_codes(code);
CREATE INDEX IF NOT EXISTS idx_upgrade_codes_active ON upgrade_codes(is_active) WHERE is_active = true;

-- Add subscription and upgrade tracking columns to user_profiles if they don't exist
DO $$ 
BEGIN
  -- Subscription status column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'subscription_status') THEN
    ALTER TABLE user_profiles ADD COLUMN subscription_status TEXT DEFAULT 'trial';
  END IF;
  
  -- Subscription plan column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'subscription_plan') THEN
    ALTER TABLE user_profiles ADD COLUMN subscription_plan TEXT;
  END IF;
  
  -- Subscription end date column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'subscription_ends_at') THEN
    ALTER TABLE user_profiles ADD COLUMN subscription_ends_at TIMESTAMPTZ;
  END IF;
  
  -- Trial end date column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'trial_ends_at') THEN
    ALTER TABLE user_profiles ADD COLUMN trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days');
  END IF;
  
  -- Upgrade tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'upgraded_at') THEN
    ALTER TABLE user_profiles ADD COLUMN upgraded_at TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'user_profiles' AND column_name = 'upgrade_code_used') THEN
    ALTER TABLE user_profiles ADD COLUMN upgrade_code_used TEXT;
  END IF;
END $$;

-- RLS Policies for upgrade_codes table
ALTER TABLE upgrade_codes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can validate upgrade codes" ON upgrade_codes;
DROP POLICY IF EXISTS "Users can redeem upgrade codes" ON upgrade_codes;

-- Users can only read active, unused codes (for validation)
CREATE POLICY "Users can validate upgrade codes"
  ON upgrade_codes
  FOR SELECT
  TO authenticated
  USING (is_active = true AND used_by IS NULL);

-- Users can update codes to mark them as used (only if unused)
CREATE POLICY "Users can redeem upgrade codes"
  ON upgrade_codes
  FOR UPDATE
  TO authenticated
  USING (is_active = true AND used_by IS NULL)
  WITH CHECK (used_by = auth.uid());

-- Grant necessary permissions
GRANT SELECT, UPDATE ON upgrade_codes TO authenticated;

-- Insert test upgrade code (skip if already exists)
INSERT INTO upgrade_codes (code, description) VALUES
  ('TESTING', 'Test upgrade code')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE upgrade_codes IS 'Stores upgrade codes that users can redeem to get Pro subscription';
COMMENT ON COLUMN upgrade_codes.code IS 'The unique upgrade code (case-insensitive, stored uppercase)';
COMMENT ON COLUMN upgrade_codes.is_active IS 'Whether the code can still be used';
COMMENT ON COLUMN upgrade_codes.expires_at IS 'Optional expiration date for the code';
COMMENT ON COLUMN upgrade_codes.used_by IS 'The user who redeemed this code';
COMMENT ON COLUMN upgrade_codes.used_at IS 'When the code was redeemed';
