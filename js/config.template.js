/**
 * Scout Bookings config template: copy to config.js and set your Supabase keys.
 * Do not commit config.js; use config.template.js as reference.
 */
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);