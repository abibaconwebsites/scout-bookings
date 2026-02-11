const SUPABASE_URL = 'https://sncrkjbvdskvbgczdesq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuY3JramJ2ZHNrdmJnY3pkZXNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjU3NTIsImV4cCI6MjA4NjMwMTc1Mn0.V1LSL35ZAenFrw9blULb3Ze77FUwvlOBpcGKxDXDj18';

// Initialize Supabase client with explicit auth configuration
// Note: window.supabase is the library from CDN, supabaseClient is our initialized client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storageKey: 'scout-bookings-auth',
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
