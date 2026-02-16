-- Migration: 008_remove_upgrade_codes
-- Description: Remove upgrade codes tables, trial columns, and related columns
-- Date: 2026-02-16

-- Drop the redemptions table first (has foreign key to upgrade_codes)
DROP TABLE IF EXISTS upgrade_code_redemptions;

-- Drop the upgrade codes table
DROP TABLE IF EXISTS upgrade_codes;

-- Remove upgrade tracking columns from user_profiles
ALTER TABLE user_profiles DROP COLUMN IF EXISTS upgraded_at;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS upgrade_code_used;

-- Remove trial-related columns from user_profiles
ALTER TABLE user_profiles DROP COLUMN IF EXISTS trial_ends_at;

-- Update subscription_status default to 'free' instead of 'trial'
ALTER TABLE user_profiles ALTER COLUMN subscription_status SET DEFAULT 'free';

-- Update any existing 'trial' status to 'free'
UPDATE user_profiles SET subscription_status = 'free' WHERE subscription_status = 'trial';
