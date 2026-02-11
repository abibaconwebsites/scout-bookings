
/**
 * Scout Bookings auth: Google OAuth, Magic Links, and session handling (Supabase).
 * No email/password authentication - uses Google OAuth and Magic Links only.
 */

// =============================================================================
// GOOGLE OAUTH AUTHENTICATION
// =============================================================================

/**
 * Initiates Google OAuth sign-in flow with Google Calendar API access.
 * Redirects user to Google for authentication, then back to dashboard on success.
 * Uses offline access and consent prompt for reliable token refresh.
 * 
 * Requests calendar scope for two-way sync:
 * - Read events from user's calendars
 * - Create events in user's calendars
 * - Update events in user's calendars
 * - Delete events in user's calendars
 */
async function signInWithGoogle() {
    try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                // Redirect to dashboard after successful authentication
                redirectTo: window.location.origin + '/pages/dashboard.html',
                // Request email, profile, and full Google Calendar access for two-way sync
                scopes: 'email profile https://www.googleapis.com/auth/calendar',
                queryParams: {
                    // Request offline access to get refresh token for background sync
                    access_type: 'offline',
                    // Force consent screen to ensure we get refresh token on re-auth
                    prompt: 'consent'
                }
            }
        });

        // Handle any errors from the OAuth initiation
        if (error) {
            console.error('Google sign-in error:', error);
            showNotification('Failed to sign in with Google. Please try again.', 'error');
            return;
        }

        // Note: On success, user is redirected to Google - no further action needed here
    } catch (err) {
        // Catch any unexpected errors
        console.error('Unexpected error during Google sign-in:', err);
        showNotification('An unexpected error occurred. Please try again.', 'error');
    }
}

// =============================================================================
// MAGIC LINK AUTHENTICATION
// =============================================================================

/**
 * Shows the magic link email input form.
 * Hides the main auth methods and displays the magic link form.
 */
function showMagicLinkForm() {
    // Hide the main authentication methods
    const authMethods = document.getElementById('auth-methods');
    if (authMethods) {
        authMethods.style.display = 'none';
    }

    // Show the magic link form
    const magicLinkForm = document.getElementById('magic-link-form');
    if (magicLinkForm) {
        magicLinkForm.classList.add('active');
    }
}

/**
 * Hides the magic link email input form.
 * Shows the main auth methods and hides the magic link form.
 */
function hideMagicLinkForm() {
    // Show the main authentication methods
    const authMethods = document.getElementById('auth-methods');
    if (authMethods) {
        authMethods.style.display = '';
    }

    // Hide the magic link form
    const magicLinkForm = document.getElementById('magic-link-form');
    if (magicLinkForm) {
        magicLinkForm.classList.remove('active');
    }
}

/**
 * Handles magic link form submission.
 * Sends a magic link email to the provided address for passwordless login.
 * 
 * @param {Event} event - The form submission event
 */
async function handleMagicLink(event) {
    // Prevent default form submission
    event.preventDefault();

    // Get the email input value
    const emailInput = document.getElementById('magic-email');
    const email = emailInput ? emailInput.value.trim() : '';

    // Validate email
    if (!email || !isValidEmail(email)) {
        showNotification('Please enter a valid email address.', 'error');
        return;
    }

    // Get the submit button and disable it
    const submitBtn = document.getElementById('magic-btn');
    const originalBtnText = submitBtn ? submitBtn.textContent : 'Send Magic Link';
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
    }

    try {
        // Send magic link email via Supabase
        const { data, error } = await supabaseClient.auth.signInWithOtp({
            email: email,
            options: {
                // Redirect to dashboard after clicking the magic link
                emailRedirectTo: window.location.origin + '/pages/dashboard.html'
            }
        });

        if (error) {
            console.error('Magic link error:', error);
            showNotification('Failed to send magic link. Please try again.', 'error');
            
            // Re-enable the button on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
            return;
        }

        // Success - show confirmation message
        showNotification('Check your email! We sent you a magic link.', 'success');

        // Hide the form and show success state
        hideMagicLinkForm();

        // Optionally show a success message element
        const successMessage = document.getElementById('magic-link-success');
        if (successMessage) {
            successMessage.style.display = 'block';
        }

    } catch (err) {
        // Catch any unexpected errors
        console.error('Unexpected error sending magic link:', err);
        showNotification('An unexpected error occurred. Please try again.', 'error');

        // Re-enable the button on error
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }
}

// =============================================================================
// AUTH CALLBACK & USER PROFILE CREATION
// =============================================================================

/**
 * Handles the authentication callback after OAuth or magic link redirect.
 * Creates a user profile record if one doesn't exist (first-time login).
 * Sets up trial subscription for new users.
 * 
 * For Google OAuth users who granted calendar permission:
 * - Extracts provider_token (access token) and provider_refresh_token from session
 * - Saves tokens to user_calendar_tokens table for Google Calendar sync
 * - These tokens enable two-way calendar synchronization features
 */
async function handleAuthCallback() {
    try {
        // Get the current session
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

        if (sessionError) {
            console.error('Session error:', sessionError);
            return;
        }

        // Check if we have a valid session with a user
        if (session && session.user) {
            const user = session.user;

            // Check if user profile already exists
            const { data: existingProfile, error: profileError } = await supabaseClient
                .from('user_profiles')
                .select('id')
                .eq('id', user.id)
                .single();

            // If profile doesn't exist (PGRST116 = no rows returned), create one
            if (profileError && profileError.code === 'PGRST116') {
                // Extract display name from user metadata or email
                const fullName = user.user_metadata?.full_name 
                    || user.user_metadata?.name 
                    || user.email.split('@')[0];

                // Calculate trial end date (14 days from now)
                const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

                // Create the user profile with trial subscription
                const { error: insertError } = await supabaseClient
                    .from('user_profiles')
                    .insert({
                        id: user.id,
                        full_name: fullName,
                        subscription_status: 'trial',
                        subscription_plan: 'basic',
                        trial_ends_at: trialEndsAt
                    });

                if (insertError) {
                    console.error('Error creating user profile:', insertError);
                    showNotification('Error setting up your profile. Please contact support.', 'error');
                } else {
                    console.log('User profile created successfully');
                }
            } else if (profileError && profileError.code !== 'PGRST116') {
                // Handle other profile errors (not "no rows found")
                console.error('Error checking user profile:', profileError);
            }

            // =================================================================
            // GOOGLE CALENDAR TOKEN STORAGE
            // =================================================================
            // After Google OAuth, the session contains provider tokens that allow
            // us to access the user's Google Calendar. These tokens are:
            // - provider_token: Short-lived access token for API calls
            // - provider_refresh_token: Long-lived token to get new access tokens
            // 
            // We save these to our database so we can sync calendar events even
            // when the user isn't actively logged in (background sync).
            // =================================================================
            
            try {
                // Extract Google Calendar tokens from the OAuth session
                // These are only present if user signed in with Google AND granted calendar permission
                const providerToken = session.provider_token;
                const providerRefreshToken = session.provider_refresh_token;

                if (providerToken && providerRefreshToken) {
                    // User granted calendar permission - save tokens for sync features
                    // saveCalendarTokens is defined in calendar.js (must be loaded before auth.js)
                    await saveCalendarTokens(user.id, providerToken, providerRefreshToken);
                    console.log('✅ Calendar tokens saved successfully');
                } else {
                    // Tokens not present - this happens when:
                    // 1. User signed in with magic link (no Google OAuth)
                    // 2. User denied calendar permission during Google OAuth
                    // 3. User previously signed in and tokens are already stored
                    // This is not an error - calendar sync features just won't be available
                    console.log('ℹ️ No calendar tokens in session - user did not grant calendar permission or used magic link');
                }
            } catch (tokenError) {
                // Log token storage errors but don't block the user
                // Calendar sync is a nice-to-have feature, not critical for login
                console.error('⚠️ Error saving calendar tokens (non-blocking):', tokenError);
            }
        }
    } catch (err) {
        console.error('Unexpected error in auth callback:', err);
    }
}

// =============================================================================
// LOGOUT
// =============================================================================

/**
 * Signs out the current user and redirects to home page.
 * Clears all session data from Supabase.
 */
async function handleLogout() {
    try {
        const { error } = await supabaseClient.auth.signOut();

        if (error) {
            console.error('Logout error:', error);
            showNotification('Failed to log out. Please try again.', 'error');
            return;
        }

        // Redirect to home page after successful logout
        window.location.href = '/index.html';

    } catch (err) {
        console.error('Unexpected error during logout:', err);
        showNotification('An unexpected error occurred. Please try again.', 'error');
    }
}

// =============================================================================
// AUTH GUARDS & STATE CHECKS
// =============================================================================

/**
 * Checks if user is authenticated. Redirects to login if not.
 * Use this function to protect pages that require authentication.
 * Waits for session to be restored from storage before checking.
 * 
 * @returns {Object|null} The user object if logged in, null otherwise
 */
async function checkAuth() {
    try {
        // First, try to get the session - Supabase will restore from localStorage
        let { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error) {
            console.error('Auth check error:', error);
            window.location.href = '/pages/login.html';
            return null;
        }

        // If no session found immediately, wait a moment for auth state to initialize
        // This handles the case where the page loads before session is restored
        if (!session) {
            // Wait for potential auth state change
            const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
                (event, newSession) => {
                    if (newSession) {
                        session = newSession;
                    }
                }
            );
            
            // Give it a brief moment to restore session from storage
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Clean up the listener
            subscription.unsubscribe();
            
            // Try getting session again
            const result = await supabaseClient.auth.getSession();
            session = result.data.session;
        }

        // If still no session, redirect to login
        if (!session) {
            window.location.href = '/pages/login.html';
            return null;
        }

        // Return the user object
        return session.user;

    } catch (err) {
        console.error('Unexpected error checking auth:', err);
        window.location.href = '/pages/login.html';
        return null;
    }
}

/**
 * Updates the navigation based on authentication state.
 * Shows Dashboard + Logout for logged-in users, Login + Sign Up for guests.
 */
async function checkAuthState() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error) {
            console.error('Auth state check error:', error);
            return;
        }

        // Find the navigation links container
        const navLinks = document.getElementById('nav-links');
        if (!navLinks) {
            return; // No nav element found, nothing to update
        }

        if (session && session.user) {
            // User is logged in - show Dashboard and Logout
            navLinks.innerHTML = `
                <a href="/pages/dashboard.html" class="nav-link">Dashboard</a>
                <button onclick="handleLogout()" class="nav-link logout-btn">Logout</button>
            `;
        } else {
            // User is not logged in - show Login and Sign Up
            navLinks.innerHTML = `
                <a href="/pages/login.html" class="nav-link">Login</a>
                <a href="/pages/signup.html" class="nav-link btn-primary">Sign Up</a>
            `;
        }

    } catch (err) {
        console.error('Unexpected error checking auth state:', err);
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize authentication on page load.
 * Handles auth callbacks on dashboard and updates nav state on all pages.
 * Sets up auth state change listener to keep session in sync.
 */
document.addEventListener('DOMContentLoaded', async function() {
    // Set up auth state change listener to handle session changes
    // This ensures the session stays in sync across page navigations
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            // User signed out, redirect to home if on a protected page
            const protectedPages = ['/dashboard', '/add-booking', '/edit-hut', '/create-hut'];
            const isProtectedPage = protectedPages.some(page => 
                window.location.pathname.includes(page)
            );
            if (isProtectedPage) {
                window.location.href = '/index.html';
            }
        }
    });

    // Check if we're on the dashboard page (auth callback destination)
    const isDashboardPage = window.location.pathname.includes('/pages/dashboard.html') 
        || window.location.pathname.includes('/dashboard');

    if (isDashboardPage) {
        // Handle the auth callback (creates profile for new users)
        await handleAuthCallback();
    }

    // Always update the navigation based on auth state
    await checkAuthState();
});
