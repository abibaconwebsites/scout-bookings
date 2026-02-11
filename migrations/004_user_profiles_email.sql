-- Add email column to user_profiles table
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

-- Populate existing records (if any)
UPDATE user_profiles
SET email = (
  SELECT email FROM auth.users WHERE auth.users.id = user_profiles.id
);
