-- Migration: 008_remove_upgrade_codes
-- Description: Remove upgrade codes tables and related columns
-- Date: 2026-02-16

-- Drop the redemptions table first (has foreign key to upgrade_codes)
DROP TABLE IF EXISTS upgrade_code_redemptions;

-- Drop the upgrade codes table
DROP TABLE IF EXISTS upgrade_codes;

-- Remove upgrade tracking columns from user_profiles
ALTER TABLE user_profiles DROP COLUMN IF EXISTS upgraded_at;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS upgrade_code_used;
