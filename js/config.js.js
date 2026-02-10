/**
 * Scout Bookings config template: copy to config.js and set your Supabase keys.
 * Do not commit config.js; use config.template.js as reference.
 */
const SUPABASE_URL = 'https://sncrkjbvdskvbgczdesq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuY3JramJ2ZHNrdmJnY3pkZXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjU3NTIsImV4cCI6MjA4NjMwMTc1Mn0.V1LSL35ZAenFrw9blULb3Ze77FUwvlOBpcGKxDXDj18';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);