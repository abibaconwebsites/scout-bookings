/**
 * Scout Bookings - Settings Page Logic
 * 
 * Comprehensive settings page with sidebar navigation and two-way Google Calendar sync.
 * Handles user preferences, calendar sync configuration, account management,
 * subscription info, team management, and notification preferences.
 * 
 * @module settings
 */

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

/** @type {string|null} The current user's hut ID */
let currentHutId = null;

/** @type {Object|null} The current user's hut data */
let currentHutData = null;

/** @type {string|null} The current user's ID */
let currentUserId = null;

/** @type {number|null} Interval ID for automatic background sync */
let autoSyncInterval = null;

/** @type {string} Currently visible panel ID */
let currentPanel = 'panel-profile';

/** @type {boolean} Whether sync is currently in progress */
let isSyncing = false;

/** @type {number} Auto-sync interval in milliseconds (15 minutes) */
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

// =============================================================================
// PART 1: SIDEBAR NAVIGATION
// =============================================================================

/**
 * Initializes the sidebar navigation.
 * Sets up click listeners on all nav items and shows the default panel.
 */
function initializeSidebar() {
    console.log('[Settings] Initializing sidebar navigation');
    
    const navItems = document.querySelectorAll('.sidebar-nav-item');
    
    if (!navItems.length) {
        console.error('[Settings] No sidebar nav items found');
        return;
    }
    
    // Remove any existing active classes first
    navItems.forEach(item => item.classList.remove('active'));
    
    // Add click listeners to each nav item
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const panelId = item.dataset.panel;
            if (panelId) {
                handleNavClick(panelId, item);
            }
        });
    });
    
    // Determine which panel to show
    let targetPanelId = 'panel-profile';
    let targetNav = document.getElementById('nav-profile');
    
    // Check URL hash for direct panel navigation
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        const hashPanelId = `panel-${hash}`;
        const hashNav = document.querySelector(`[data-panel="${hashPanelId}"]`);
        if (hashNav) {
            targetPanelId = hashPanelId;
            targetNav = hashNav;
        }
    }
    
    // Set the target nav as active and show the panel
    if (targetNav) {
        targetNav.classList.add('active');
    }
    showPanel(targetPanelId);
    currentPanel = targetPanelId;
    
    console.log('[Settings] Sidebar initialized with panel:', targetPanelId);
}

/**
 * Handles navigation item click.
 * Updates active states, shows the selected panel, and updates URL hash.
 * 
 * @param {string} panelId - The ID of the panel to show
 * @param {HTMLElement} clickedNav - The clicked navigation element
 */
function handleNavClick(panelId, clickedNav) {
    console.log('[Settings] Navigation clicked:', panelId);
    
    // Remove active class from all nav items
    const navItems = document.querySelectorAll('.sidebar-nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    
    // Add active class to clicked nav item
    if (clickedNav) {
        clickedNav.classList.add('active');
    }
    
    // Show selected panel
    showPanel(panelId);
    
    // Store current panel
    currentPanel = panelId;
    
    // Update URL hash for bookmarking (without triggering hashchange)
    const hashName = panelId.replace('panel-', '');
    history.replaceState(null, null, `#${hashName}`);
    
    // Load panel-specific data
    loadPanelData(panelId);
}

/**
 * Shows the specified panel and hides all others.
 * 
 * @param {string} panelId - The ID of the panel to show
 */
function showPanel(panelId) {
    const panels = [
        'panel-profile',
        'panel-calendar',
        'panel-availability',
        'panel-sessions',
        'panel-subscription',
        'panel-team',
        'panel-notifications'
    ];
    
    panels.forEach(id => {
        const panel = document.getElementById(id);
        if (panel) {
            if (id === panelId) {
                panel.classList.add('active');
                panel.style.display = 'block';
            } else {
                panel.classList.remove('active');
                panel.style.display = 'none';
            }
        }
    });
}

/**
 * Loads data specific to the selected panel.
 * 
 * @param {string} panelId - The ID of the panel to load data for
 */
async function loadPanelData(panelId) {
    switch (panelId) {
        case 'panel-calendar':
            await loadCalendarPanel();
            break;
        case 'panel-availability':
            await loadAvailabilityPanel();
            break;
        case 'panel-sessions':
            await loadSessionsPanel();
            break;
        case 'panel-profile':
            await loadProfilePanel();
            break;
        case 'panel-subscription':
            await loadSubscriptionPanel();
            break;
        case 'panel-team':
            await loadTeamPanel();
            break;
        case 'panel-notifications':
            await loadNotificationsPanel();
            break;
    }
}

// =============================================================================
// PART 2: PAGE INITIALIZATION
// =============================================================================

/**
 * Main initialization function for the settings page.
 * Checks authentication, loads user data, and sets up the page.
 */
async function loadSettings() {
    console.log('[Settings] Loading settings page');
    
    try {
        // Check authentication
        const user = await checkAuth();
        if (!user) {
            console.log('[Settings] User not authenticated, redirecting to login');
            window.location.href = 'login.html';
            return;
        }
        
        currentUserId = user.id;
        console.log('[Settings] User authenticated:', currentUserId);
        
        // Handle OAuth callback if returning from Google Calendar authorization
        await handleCalendarOAuthCallback(currentUserId);
        
        // Load user's hut
        const hut = await getUserHut(currentUserId);
        if (hut) {
            currentHutId = hut.id;
            currentHutData = hut;
            console.log('[Settings] User hut loaded:', currentHutId, hut.name);
            
            // Load pending bookings for notification badge
            if (typeof loadPendingBookingsNotifications === 'function') {
                loadPendingBookingsNotifications(currentHutId);
            }
        } else {
            console.log('[Settings] No hut found for user');
        }
        
        // Initialize sidebar navigation (sets currentPanel)
        initializeSidebar();
        
        // Setup event listeners
        setupEventListeners();
        
        // Load initial panel data (uses currentPanel set by initializeSidebar)
        console.log('[Settings] Loading data for panel:', currentPanel);
        await loadPanelData(currentPanel);
        
        console.log('[Settings] Settings page loaded successfully');
        
    } catch (err) {
        console.error('[Settings] Error loading settings:', err);
        showNotification('Failed to load settings', 'error');
    }
}

/**
 * Handles the OAuth callback when returning from Google Calendar authorization.
 * Saves the calendar tokens if present in the session.
 * 
 * Only saves tokens if:
 * 1. Provider tokens exist in the session (from OAuth flow)
 * 2. We set a flag indicating we initiated OAuth (prevents re-saving after disconnect)
 * 
 * @param {string} userId - The current user's ID
 */
async function handleCalendarOAuthCallback(userId) {
    try {
        // Check if we initiated an OAuth flow (set by handleConnectCalendar)
        const pendingOAuth = sessionStorage.getItem('pendingCalendarOAuth');
        
        if (!pendingOAuth) {
            console.log('[Settings] No pending OAuth flow, skipping callback check');
            return;
        }
        
        // Get the current session to check for provider tokens
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        
        if (sessionError || !session) {
            console.log('[Settings] No session found for OAuth callback check');
            return;
        }
        
        // Check if we have provider tokens (indicates OAuth just completed with calendar scope)
        const providerToken = session.provider_token;
        const providerRefreshToken = session.provider_refresh_token;
        
        if (providerToken && providerRefreshToken) {
            console.log('[Settings] Found provider tokens from OAuth callback, saving calendar credentials');
            
            // Clear the pending OAuth flag
            sessionStorage.removeItem('pendingCalendarOAuth');
            
            // Save the calendar tokens
            // saveCalendarTokens is defined in calendar.js
            if (typeof saveCalendarTokens === 'function') {
                await saveCalendarTokens(userId, providerToken, providerRefreshToken);
                console.log('[Settings] ✅ Calendar tokens saved successfully');
                showNotification('Google Calendar connected successfully!', 'success');
            } else {
                console.error('[Settings] saveCalendarTokens function not found - ensure calendar.js is loaded');
            }
        } else {
            console.log('[Settings] No provider tokens in session despite pending OAuth');
            // Clear the flag anyway to prevent stale state
            sessionStorage.removeItem('pendingCalendarOAuth');
        }
    } catch (err) {
        console.error('[Settings] Error handling calendar OAuth callback:', err);
        // Don't show error to user - this runs on every page load
        sessionStorage.removeItem('pendingCalendarOAuth');
    }
}

/**
 * Loads the Calendar Sync panel data.
 * Checks connection status and loads sync settings.
 */
async function loadCalendarPanel() {
    console.log('[Settings] Loading calendar panel');
    
    if (!currentUserId) {
        console.error('[Settings] No user ID available');
        return;
    }
    
    try {
        // Check if calendar tokens exist
        const accessToken = await getCalendarTokens(currentUserId);
        
        if (accessToken) {
            // User is connected
            console.log('[Settings] User has calendar tokens, loading connected state');
            await loadConnectedState(currentUserId);
        } else {
            // User is not connected
            console.log('[Settings] No calendar tokens found, showing disconnected state');
            updateConnectionUI(false);
        }
        
    } catch (err) {
        console.error('[Settings] Error loading calendar panel:', err);
        updateConnectionUI(false);
    }
}

/**
 * Loads the Profile panel data.
 * Fetches user data from Supabase auth and user_profiles table,
 * then populates the profile form fields.
 */
async function loadProfilePanel() {
    console.log('[Settings] Loading profile panel');
    
    if (!currentUserId) {
        console.log('[Settings] No currentUserId, cannot load profile');
        return;
    }
    
    try {
        // Get user data from Supabase auth
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        
        if (authError || !user) {
            console.error('[Settings] Error getting user:', authError);
            return;
        }
        
        console.log('[Settings] Got user from auth:', user.email);
        
        // Get profile data from user_profiles table
        const { data: profile, error: profileError } = await supabaseClient
            .from('user_profiles')
            .select('full_name, phone')
            .eq('id', currentUserId)
            .single();
        
        if (profileError && profileError.code !== 'PGRST116') {
            console.error('[Settings] Error loading profile:', profileError);
        }
        
        console.log('[Settings] Got profile from database:', profile);
        
        // Get form elements
        const firstNameEl = document.getElementById('profile-first-name');
        const lastNameEl = document.getElementById('profile-last-name');
        const emailEl = document.getElementById('profile-email');
        const phoneEl = document.getElementById('profile-phone');
        const organisationEl = document.getElementById('profile-organisation');
        const createdEl = document.getElementById('account-created');
        const lastSignInEl = document.getElementById('last-sign-in');
        
        console.log('[Settings] Form elements found:', {
            firstNameEl: !!firstNameEl,
            lastNameEl: !!lastNameEl,
            emailEl: !!emailEl,
            phoneEl: !!phoneEl,
            organisationEl: !!organisationEl,
            createdEl: !!createdEl,
            lastSignInEl: !!lastSignInEl
        });
        
        // Parse full name into first/last from profile or auth metadata
        const fullName = profile?.full_name || 
                        user.user_metadata?.full_name || 
                        user.user_metadata?.name || 
                        '';
        const nameParts = fullName.split(' ');
        const firstName = user.user_metadata?.first_name || nameParts[0] || '';
        const lastName = user.user_metadata?.last_name || nameParts.slice(1).join(' ') || '';
        
        console.log('[Settings] Parsed name:', { firstName, lastName, fullName });
        
        // Populate form fields
        if (firstNameEl) {
            firstNameEl.value = firstName;
            console.log('[Settings] Set first name:', firstName);
        }
        
        if (lastNameEl) {
            lastNameEl.value = lastName;
            console.log('[Settings] Set last name:', lastName);
        }
        
        if (emailEl) {
            emailEl.value = user.email || '';
            console.log('[Settings] Set email:', user.email);
        }
        
        if (phoneEl) {
            phoneEl.value = profile?.phone || user.user_metadata?.phone || user.phone || '';
        }
        
        if (organisationEl) {
            // Use hut name (group name) if available, otherwise fall back to user metadata
            organisationEl.value = currentHutData?.name || user.user_metadata?.organisation || '';
        }
        
        // Account details (read-only display)
        if (createdEl) {
            const created = new Date(user.created_at);
            createdEl.textContent = created.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }
        
        if (lastSignInEl) {
            const lastSignIn = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
            lastSignInEl.textContent = lastSignIn 
                ? lastSignIn.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Never';
        }
        
        console.log('[Settings] Profile panel loaded successfully');
        
    } catch (err) {
        console.error('[Settings] Error loading profile panel:', err);
    }
}

/**
 * Handles profile form submission.
 * Saves profile data to both Supabase auth metadata and user_profiles table.
 * 
 * @param {Event} e - Form submit event
 */
async function handleProfileFormSubmit(e) {
    e.preventDefault();
    
    const saveBtn = document.getElementById('save-profile-btn');
    const originalText = saveBtn?.textContent || 'Save Profile';
    
    if (saveBtn) {
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;
    }
    
    try {
        const firstName = document.getElementById('profile-first-name')?.value.trim() || '';
        const lastName = document.getElementById('profile-last-name')?.value.trim() || '';
        const phone = document.getElementById('profile-phone')?.value.trim() || '';
        const organisation = document.getElementById('profile-organisation')?.value.trim() || '';
        const fullName = `${firstName} ${lastName}`.trim();
        
        // Update Supabase auth user metadata
        const { error: authError } = await supabaseClient.auth.updateUser({
            data: {
                first_name: firstName,
                last_name: lastName,
                full_name: fullName,
                phone: phone,
                organisation: organisation
            }
        });
        
        if (authError) {
            throw authError;
        }
        
        // Update user_profiles table
        const { error: profileError } = await supabaseClient
            .from('user_profiles')
            .update({
                full_name: fullName,
                phone: phone
            })
            .eq('id', currentUserId);
        
        if (profileError) {
            console.error('[Settings] Error updating user_profiles:', profileError);
            // Don't throw - auth update succeeded, profile table may not exist yet
        }
        
        showNotification('Profile updated successfully', 'success');
        console.log('[Settings] Profile saved successfully');
        
    } catch (err) {
        console.error('[Settings] Error saving profile:', err);
        showNotification('Failed to save profile', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }
}

/**
 * Handles delete account button click.
 * Shows confirmation and placeholder message.
 */
function handleDeleteAccount() {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
        showNotification('Account deletion is not yet implemented. Please contact support.', 'info');
    }
}

/**
 * Loads the Subscription panel data.
 * Displays current plan, trial status, renewal information, and upgrade code form.
 */
async function loadSubscriptionPanel() {
    console.log('[Settings] Loading subscription panel');
    
    if (!currentUserId) return;
    
    try {
        // Get user profile with subscription info
        const { data: profile, error } = await supabaseClient
            .from('user_profiles')
            .select('subscription_status, trial_ends_at, subscription_plan, subscription_ends_at, upgrade_code_used')
            .eq('id', currentUserId)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('[Settings] Error loading subscription:', error);
            return;
        }
        
        const planBadge = document.getElementById('user-plan');
        const trialStatus = document.getElementById('trial-status');
        const trialStatusText = document.getElementById('trial-status-text');
        const renewalDate = document.getElementById('renewal-date');
        const upgradeCodeSection = document.getElementById('upgrade-code-section');
        
        if (profile) {
            const isPro = profile.subscription_status === 'pro' || profile.subscription_plan === 'pro';
            
            // Set plan badge
            if (planBadge) {
                const status = profile.subscription_plan || profile.subscription_status || 'Free';
                planBadge.textContent = capitalizeFirst(status);
                
                // Update badge color for Pro
                if (isPro) {
                    planBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
                    planBadge.style.color = '#059669';
                }
            }
            
            // Show trial status if applicable
            if (profile.subscription_status === 'trial' && profile.trial_ends_at) {
                const trialEnd = new Date(profile.trial_ends_at);
                const now = new Date();
                const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
                
                if (trialStatus && trialStatusText && daysLeft > 0) {
                    trialStatus.style.display = 'block';
                    trialStatusText.textContent = `Your trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
                } else if (trialStatus) {
                    trialStatus.style.display = 'none';
                }
            } else if (trialStatus) {
                trialStatus.style.display = 'none';
            }
            
            // Set renewal date
            if (renewalDate) {
                if (profile.subscription_ends_at) {
                    const endDate = new Date(profile.subscription_ends_at);
                    renewalDate.textContent = endDate.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                    });
                } else {
                    renewalDate.textContent = 'N/A';
                }
            }
            
            // Hide upgrade code section if user already has Pro
            if (upgradeCodeSection) {
                if (isPro) {
                    upgradeCodeSection.style.display = 'none';
                } else {
                    upgradeCodeSection.style.display = 'block';
                }
            }
        }
        
        // Set up upgrade code form handler
        setupUpgradeCodeForm();
        
        console.log('[Settings] Subscription panel loaded');
        
    } catch (err) {
        console.error('[Settings] Error loading subscription panel:', err);
    }
}

/**
 * Sets up the upgrade code form event listener.
 */
function setupUpgradeCodeForm() {
    const form = document.getElementById('upgrade-code-form');
    if (!form || form.dataset.listenerAttached) return;
    
    form.dataset.listenerAttached = 'true';
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleUpgradeCodeSubmit();
    });
}

/**
 * Handles upgrade code form submission.
 * Validates and redeems the upgrade code.
 */
async function handleUpgradeCodeSubmit() {
    const input = document.getElementById('upgrade-code-input');
    const submitBtn = document.getElementById('redeem-code-btn');
    const errorDiv = document.getElementById('upgrade-code-error');
    const successDiv = document.getElementById('upgrade-code-success');
    
    const code = input.value.trim().toUpperCase();
    
    // Reset messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    if (!code) {
        errorDiv.textContent = 'Please enter an upgrade code';
        errorDiv.style.display = 'block';
        return;
    }
    
    // Disable button and show loading
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Redeeming...';
    
    try {
        // Call the redeem function
        const { data, error } = await supabaseClient.rpc('redeem_upgrade_code', {
            p_code: code
        });
        
        if (error) {
            console.error('[Settings] Error redeeming code:', error);
            errorDiv.textContent = error.message || 'Failed to redeem code. Please try again.';
            errorDiv.style.display = 'block';
            return;
        }
        
        // Check the result
        if (data && data.success) {
            // Success!
            successDiv.innerHTML = `
                <strong>Success!</strong> Your account has been upgraded to <strong>${capitalizeFirst(data.plan)}</strong>.
                ${data.expires_at ? `<br>Your subscription is valid until ${new Date(data.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` : ''}
            `;
            successDiv.style.display = 'block';
            input.value = '';
            
            // Reload the subscription panel to reflect changes
            setTimeout(() => {
                loadSubscriptionPanel();
            }, 2000);
            
            showNotification('Upgrade successful! Welcome to Pro.', 'success');
        } else {
            // Error from the function
            errorDiv.textContent = data?.error || 'Failed to redeem code. Please check the code and try again.';
            errorDiv.style.display = 'block';
        }
        
    } catch (err) {
        console.error('[Settings] Exception redeeming code:', err);
        errorDiv.textContent = 'An error occurred. Please try again.';
        errorDiv.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

/**
 * Loads the Team panel data.
 * Displays team members, pending invitations, and roles.
 */
async function loadTeamPanel() {
    console.log('[Settings] Loading team panel');
    
    if (!currentUserId) return;
    
    const noHutEl = document.getElementById('team-no-hut');
    const teamContent = document.getElementById('team-settings-content');
    
    // Check if user has a hut
    if (!currentHutId) {
        if (noHutEl) noHutEl.style.display = 'block';
        if (teamContent) teamContent.style.display = 'none';
        console.log('[Settings] No hut found for team panel');
        return;
    }
    
    // Show team content, hide no hut message
    if (noHutEl) noHutEl.style.display = 'none';
    if (teamContent) teamContent.style.display = 'block';
    
    try {
        // Get current user info
        const { data: { user }, error } = await supabaseClient.auth.getUser();
        
        if (error || !user) {
            console.error('[Settings] Error getting user for team panel:', error);
            return;
        }
        
        // Load team members (owner + team_members)
        await loadTeamMembers(user);
        
        // Load pending invitations
        await loadPendingInvitations();
        
        // Setup team event listeners
        setupTeamEventListeners();
        
        console.log('[Settings] Team panel loaded');
        
    } catch (err) {
        console.error('[Settings] Error loading team panel:', err);
    }
}

/**
 * Loads and displays team members for the current hut.
 * @param {Object} currentUser - The current authenticated user
 */
async function loadTeamMembers(currentUser) {
    const teamList = document.getElementById('team-members-list');
    if (!teamList) return;
    
    try {
        // Get hut owner info
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('owner_id')
            .eq('id', currentHutId)
            .single();
        
        if (hutError) {
            console.error('[Settings] Error getting hut owner:', hutError);
            return;
        }
        
        // Get owner profile
        const { data: ownerProfile, error: ownerError } = await supabaseClient
            .from('user_profiles')
            .select('id, full_name')
            .eq('id', hut.owner_id)
            .single();
        
        // Get team members
        const { data: teamMembers, error: teamError } = await supabaseClient
            .from('team_members')
            .select(`
                id,
                user_id,
                role,
                joined_at,
                user_profiles (
                    id,
                    full_name
                )
            `)
            .eq('hut_id', currentHutId)
            .order('joined_at', { ascending: true });
        
        if (teamError && teamError.code !== 'PGRST116') {
            console.error('[Settings] Error loading team members:', teamError);
        }
        
        // Build team members HTML
        let html = '';
        
        // Add owner first
        const ownerName = ownerProfile?.full_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Owner';
        const ownerEmail = currentUser.email;
        const ownerInitials = getInitials(ownerName);
        const isCurrentUserOwner = hut.owner_id === currentUserId;
        
        // Check if current user can manage team (owner or admin)
        const userCanManageTeam = isCurrentUserOwner || await canManageTeam();
        
        html += `
            <div class="team-member" data-user-id="${hut.owner_id}">
                <div class="team-member-avatar">${escapeHtml(ownerInitials)}</div>
                <div class="team-member-info">
                    <div class="team-member-name">${escapeHtml(ownerName)}${hut.owner_id === currentUserId ? ' (You)' : ''}</div>
                    <div class="team-member-email">${escapeHtml(ownerEmail)}</div>
                </div>
                <div class="team-member-role owner">Owner</div>
            </div>
        `;
        
        // Add team members
        if (teamMembers && teamMembers.length > 0) {
            for (const member of teamMembers) {
                // Get member's email from auth (we need to fetch it separately)
                const memberName = member.user_profiles?.full_name || 'Team Member';
                const memberInitials = getInitials(memberName);
                const isCurrentUser = member.user_id === currentUserId;
                const roleClass = member.role === 'admin' ? 'admin' : '';
                
                // Escape member name for use in onclick handlers (handle quotes)
                const escapedMemberName = memberName.replace(/'/g, "\\'").replace(/"/g, '\\"');
                
                html += `
                    <div class="team-member" data-member-id="${member.id}" data-user-id="${member.user_id}">
                        <div class="team-member-avatar">${escapeHtml(memberInitials)}</div>
                        <div class="team-member-info">
                            <div class="team-member-name">${escapeHtml(memberName)}${isCurrentUser ? ' (You)' : ''}</div>
                            <div class="team-member-email">Joined ${formatDate(member.joined_at)}</div>
                        </div>
                        <div class="team-member-role ${roleClass}">${capitalizeFirst(member.role)}</div>
                        ${userCanManageTeam ? `
                            <div class="team-member-actions">
                                <button class="btn-icon" onclick="openEditRoleModal('${member.id}', '${escapedMemberName}', '${member.role}')" title="Change role">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                </button>
                                <button class="btn-icon danger" onclick="removeTeamMember('${member.id}', '${escapedMemberName}')" title="Remove member">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;
            }
        }
        
        teamList.innerHTML = html;
        
    } catch (err) {
        console.error('[Settings] Error loading team members:', err);
        teamList.innerHTML = '<div class="feature-locked">Error loading team members</div>';
    }
}

/**
 * Loads and displays pending invitations for the current hut.
 */
async function loadPendingInvitations() {
    const invitationsCard = document.getElementById('pending-invitations-card');
    const invitationsList = document.getElementById('pending-invitations-list');
    
    if (!invitationsCard || !invitationsList) return;
    
    try {
        const { data: invitations, error } = await supabaseClient
            .from('team_invitations')
            .select('*')
            .eq('hut_id', currentHutId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        
        if (error && error.code !== 'PGRST116') {
            console.error('[Settings] Error loading invitations:', error);
            return;
        }
        
        if (!invitations || invitations.length === 0) {
            invitationsCard.style.display = 'none';
            return;
        }
        
        // Show the card and build HTML
        invitationsCard.style.display = 'block';
        
        let html = '';
        for (const invitation of invitations) {
            const expiresAt = new Date(invitation.expires_at);
            const now = new Date();
            const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
            const isExpired = daysLeft <= 0;
            
            html += `
                <div class="pending-invitation" data-invitation-id="${invitation.id}">
                    <div class="pending-invitation-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                    </div>
                    <div class="pending-invitation-info">
                        <div class="pending-invitation-email">${escapeHtml(invitation.email)}</div>
                        <div class="pending-invitation-meta">
                            ${capitalizeFirst(invitation.role)} · ${isExpired ? 'Expired' : `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
                        </div>
                    </div>
                    <div class="pending-invitation-status">${isExpired ? 'Expired' : 'Pending'}</div>
                    <div class="team-member-actions">
                        <button class="btn-icon" onclick="resendInvitation('${invitation.id}', '${invitation.email}')" title="Resend invitation">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                            </svg>
                        </button>
                        <button class="btn-icon danger" onclick="revokeInvitation('${invitation.id}', '${invitation.email}')" title="Revoke invitation">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }
        
        invitationsList.innerHTML = html;
        
    } catch (err) {
        console.error('[Settings] Error loading pending invitations:', err);
    }
}

/**
 * Checks if the current user can manage team members.
 * @returns {Promise<boolean>} True if user is owner or admin
 */
async function canManageTeam() {
    if (!currentHutId || !currentUserId) return false;
    
    try {
        // Check if owner
        const { data: hut } = await supabaseClient
            .from('scout_huts')
            .select('owner_id')
            .eq('id', currentHutId)
            .single();
        
        if (hut?.owner_id === currentUserId) return true;
        
        // Check if admin
        const { data: membership } = await supabaseClient
            .from('team_members')
            .select('role')
            .eq('hut_id', currentHutId)
            .eq('user_id', currentUserId)
            .single();
        
        return membership?.role === 'admin';
        
    } catch (err) {
        return false;
    }
}

/**
 * Sets up event listeners for team management.
 */
function setupTeamEventListeners() {
    // Invite button
    const inviteBtn = document.getElementById('invite-team-btn');
    if (inviteBtn) {
        inviteBtn.onclick = openInviteModal;
    }
    
    // Invite modal close buttons
    const inviteModalClose = document.getElementById('invite-modal-close');
    const inviteCancelBtn = document.getElementById('invite-cancel-btn');
    if (inviteModalClose) inviteModalClose.onclick = closeInviteModal;
    if (inviteCancelBtn) inviteCancelBtn.onclick = closeInviteModal;
    
    // Send invitation button
    const inviteSendBtn = document.getElementById('invite-send-btn');
    if (inviteSendBtn) {
        inviteSendBtn.onclick = sendInvitation;
    }
    
    // Role option selection styling
    const roleOptions = document.querySelectorAll('.role-option');
    roleOptions.forEach(option => {
        option.addEventListener('click', function() {
            // Remove selected from siblings
            const siblings = this.parentElement.querySelectorAll('.role-option');
            siblings.forEach(s => s.classList.remove('selected'));
            // Add selected to clicked
            this.classList.add('selected');
        });
    });
    
    // Edit role modal close buttons
    const editRoleModalClose = document.getElementById('edit-role-modal-close');
    const editRoleCancelBtn = document.getElementById('edit-role-cancel-btn');
    if (editRoleModalClose) editRoleModalClose.onclick = closeEditRoleModal;
    if (editRoleCancelBtn) editRoleCancelBtn.onclick = closeEditRoleModal;
    
    // Save role button
    const editRoleSaveBtn = document.getElementById('edit-role-save-btn');
    if (editRoleSaveBtn) {
        editRoleSaveBtn.onclick = saveRoleChange;
    }
    
    // Close modals on overlay click
    const inviteModal = document.getElementById('invite-modal');
    const editRoleModal = document.getElementById('edit-role-modal');
    
    if (inviteModal) {
        inviteModal.addEventListener('click', function(e) {
            if (e.target === this) closeInviteModal();
        });
    }
    
    if (editRoleModal) {
        editRoleModal.addEventListener('click', function(e) {
            if (e.target === this) closeEditRoleModal();
        });
    }
}

/**
 * Opens the invite team member modal.
 */
function openInviteModal() {
    const modal = document.getElementById('invite-modal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('invite-email')?.focus();
    }
}

/**
 * Closes the invite team member modal.
 */
function closeInviteModal() {
    const modal = document.getElementById('invite-modal');
    if (modal) {
        modal.classList.remove('active');
        // Reset form
        const emailInput = document.getElementById('invite-email');
        if (emailInput) emailInput.value = '';
        // Reset role to member
        const memberRadio = document.querySelector('input[name="invite-role"][value="member"]');
        if (memberRadio) {
            memberRadio.checked = true;
            document.querySelectorAll('#invite-modal .role-option').forEach(o => o.classList.remove('selected'));
            document.getElementById('role-member-option')?.classList.add('selected');
        }
    }
}

/**
 * Sends a team invitation.
 */
async function sendInvitation() {
    const emailInput = document.getElementById('invite-email');
    const roleInput = document.querySelector('input[name="invite-role"]:checked');
    const sendBtn = document.getElementById('invite-send-btn');
    
    const email = emailInput?.value?.trim();
    const role = roleInput?.value || 'member';
    
    if (!email) {
        showNotification('Please enter an email address', 'error');
        return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showNotification('Please enter a valid email address', 'error');
        return;
    }
    
    // Disable button
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
    }
    
    try {
        // Check if user is already a team member
        const { data: existingMember } = await supabaseClient
            .from('team_members')
            .select('id')
            .eq('hut_id', currentHutId)
            .eq('user_id', (await supabaseClient.from('user_profiles').select('id').eq('email', email).single()).data?.id)
            .single();
        
        if (existingMember) {
            showNotification('This user is already a team member', 'error');
            return;
        }
        
        // Check if there's already a pending invitation
        const { data: existingInvitation } = await supabaseClient
            .from('team_invitations')
            .select('id')
            .eq('hut_id', currentHutId)
            .eq('email', email.toLowerCase())
            .eq('status', 'pending')
            .single();
        
        if (existingInvitation) {
            showNotification('An invitation has already been sent to this email', 'error');
            return;
        }
        
        // Generate invitation token
        const token = generateInvitationToken();
        
        // Create invitation
        const { data: invitation, error } = await supabaseClient
            .from('team_invitations')
            .insert({
                hut_id: currentHutId,
                email: email.toLowerCase(),
                role: role,
                token: token,
                invited_by: currentUserId,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
            })
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        // In a real app, you would send an email here with the invitation link
        // For now, we'll just show a success message with the link
        const inviteLink = `${window.location.origin}/pages/accept-invite.html?token=${token}`;
        
        console.log('[Settings] Invitation created:', invitation);
        console.log('[Settings] Invitation link:', inviteLink);
        
        showNotification(`Invitation sent to ${email}`, 'success');
        
        // Close modal and refresh invitations list
        closeInviteModal();
        await loadPendingInvitations();
        
    } catch (err) {
        console.error('[Settings] Error sending invitation:', err);
        showNotification('Failed to send invitation', 'error');
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Invitation';
        }
    }
}

/**
 * Generates a URL-safe invitation token.
 * @returns {string} A random token
 */
function generateInvitationToken() {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Resends an invitation.
 * @param {string} invitationId - The invitation ID
 * @param {string} email - The email address
 */
async function resendInvitation(invitationId, email) {
    try {
        // Generate new token and extend expiry
        const newToken = generateInvitationToken();
        
        const { error } = await supabaseClient
            .from('team_invitations')
            .update({
                token: newToken,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            })
            .eq('id', invitationId);
        
        if (error) throw error;
        
        // In a real app, send the email here
        const inviteLink = `${window.location.origin}/pages/accept-invite.html?token=${newToken}`;
        console.log('[Settings] Resent invitation link:', inviteLink);
        
        showNotification(`Invitation resent to ${email}`, 'success');
        await loadPendingInvitations();
        
    } catch (err) {
        console.error('[Settings] Error resending invitation:', err);
        showNotification('Failed to resend invitation', 'error');
    }
}

/**
 * Revokes an invitation.
 * @param {string} invitationId - The invitation ID
 * @param {string} email - The email address
 */
async function revokeInvitation(invitationId, email) {
    const confirmed = confirm(`Revoke invitation for ${email}?`);
    if (!confirmed) return;
    
    try {
        const { error } = await supabaseClient
            .from('team_invitations')
            .update({ status: 'revoked' })
            .eq('id', invitationId);
        
        if (error) throw error;
        
        showNotification('Invitation revoked', 'success');
        await loadPendingInvitations();
        
    } catch (err) {
        console.error('[Settings] Error revoking invitation:', err);
        showNotification('Failed to revoke invitation', 'error');
    }
}

/** @type {string|null} Currently editing member ID */
let editingMemberId = null;

/**
 * Opens the edit role modal.
 * @param {string} memberId - The team member ID
 * @param {string} memberName - The member's name
 * @param {string} currentRole - The current role
 */
function openEditRoleModal(memberId, memberName, currentRole) {
    editingMemberId = memberId;
    
    const modal = document.getElementById('edit-role-modal');
    const nameEl = document.getElementById('edit-role-member-name');
    
    if (nameEl) nameEl.textContent = memberName;
    
    // Set current role
    const roleRadio = document.querySelector(`input[name="edit-role"][value="${currentRole}"]`);
    if (roleRadio) {
        roleRadio.checked = true;
        // Update selected styling
        document.querySelectorAll('#edit-role-modal .role-option').forEach(o => o.classList.remove('selected'));
        roleRadio.closest('.role-option')?.classList.add('selected');
    }
    
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * Closes the edit role modal.
 */
function closeEditRoleModal() {
    const modal = document.getElementById('edit-role-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    editingMemberId = null;
}

/**
 * Saves the role change.
 */
async function saveRoleChange() {
    if (!editingMemberId) return;
    
    const roleInput = document.querySelector('input[name="edit-role"]:checked');
    const newRole = roleInput?.value;
    
    if (!newRole) {
        showNotification('Please select a role', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('edit-role-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const { error } = await supabaseClient
            .from('team_members')
            .update({ role: newRole })
            .eq('id', editingMemberId);
        
        if (error) throw error;
        
        showNotification('Role updated successfully', 'success');
        closeEditRoleModal();
        
        // Refresh team members list
        const { data: { user } } = await supabaseClient.auth.getUser();
        await loadTeamMembers(user);
        
    } catch (err) {
        console.error('[Settings] Error updating role:', err);
        showNotification('Failed to update role', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    }
}

/**
 * Removes a team member.
 * @param {string} memberId - The team member ID
 * @param {string} memberName - The member's name
 */
async function removeTeamMember(memberId, memberName) {
    const confirmed = confirm(`Remove ${memberName} from the team? They will lose access to this hut.`);
    if (!confirmed) return;
    
    try {
        const { error } = await supabaseClient
            .from('team_members')
            .delete()
            .eq('id', memberId);
        
        if (error) throw error;
        
        showNotification(`${memberName} has been removed from the team`, 'success');
        
        // Refresh team members list
        const { data: { user } } = await supabaseClient.auth.getUser();
        await loadTeamMembers(user);
        
    } catch (err) {
        console.error('[Settings] Error removing team member:', err);
        showNotification('Failed to remove team member', 'error');
    }
}

/**
 * Formats a date for display.
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Loads the Notifications panel data.
 * Displays notification preferences.
 */
async function loadNotificationsPanel() {
    console.log('[Settings] Loading notifications panel');
    
    if (!currentUserId) return;
    
    try {
        // Get user notification settings
        const { data, error } = await supabaseClient
            .from('user_settings')
            .select('notification_preferences')
            .eq('user_id', currentUserId)
            .single();
        
        if (error && error.code !== 'PGRST116') {
            console.error('[Settings] Error loading notification settings:', error);
            return;
        }
        
        if (data?.notification_preferences) {
            const prefs = data.notification_preferences;
            
            // Apply settings to UI
            const bookingCreated = document.getElementById('notify-booking-created');
            const bookingReminder = document.getElementById('notify-booking-reminder');
            const bookingCancelled = document.getElementById('notify-booking-cancelled');
            const reminderTiming = document.getElementById('reminder-timing');
            
            if (bookingCreated) bookingCreated.checked = prefs.booking_created !== false;
            if (bookingReminder) bookingReminder.checked = prefs.booking_reminder !== false;
            if (bookingCancelled) bookingCancelled.checked = prefs.booking_cancelled !== false;
            if (reminderTiming && prefs.reminder_days) reminderTiming.value = prefs.reminder_days.toString();
        }
        
        console.log('[Settings] Notifications panel loaded');
        
    } catch (err) {
        console.error('[Settings] Error loading notifications panel:', err);
    }
}

// =============================================================================
// PART 2B: AVAILABILITY PANEL
// =============================================================================

/**
 * Loads the Availability panel data.
 * Displays hut availability schedule.
 */
async function loadAvailabilityPanel() {
    console.log('[Settings] Loading availability panel');
    
    if (!currentUserId) return;
    
    const noHutEl = document.getElementById('availability-no-hut');
    const settingsEl = document.getElementById('availability-settings');
    
    // Check if user has a hut
    if (!currentHutId) {
        // Show no hut message
        if (noHutEl) noHutEl.style.display = 'block';
        if (settingsEl) settingsEl.style.display = 'none';
        console.log('[Settings] No hut found for availability panel');
        return;
    }
    
    // Show settings, hide no hut message
    if (noHutEl) noHutEl.style.display = 'none';
    if (settingsEl) settingsEl.style.display = 'block';
    
    try {
        // Get hut availability data
        const { data: hut, error } = await supabaseClient
            .from('scout_huts')
            .select('availability')
            .eq('id', currentHutId)
            .single();
        
        if (error) {
            console.error('[Settings] Error loading availability:', error);
            return;
        }
        
        // Populate the availability UI
        if (hut?.availability) {
            populateAvailability(hut.availability);
        }
        
        // Set up day toggle listeners
        setupDayToggles();
        
        console.log('[Settings] Availability panel loaded');
        
    } catch (err) {
        console.error('[Settings] Error loading availability panel:', err);
    }
}

/**
 * Populates the availability schedule UI with existing data.
 * 
 * @param {Object} availability - The availability object from the database
 */
function populateAvailability(availability) {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const dayConfig = availability[day];
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        
        if (checkbox && row) {
            if (dayConfig) {
                checkbox.checked = dayConfig.enabled || false;
                row.querySelector('.start-time').value = dayConfig.start_time || '09:00';
                row.querySelector('.end-time').value = dayConfig.end_time || '21:00';
            } else {
                checkbox.checked = false;
            }
            
            // Update row disabled state
            if (checkbox.checked) {
                row.classList.remove('disabled');
            } else {
                row.classList.add('disabled');
            }
        }
    });
}

/**
 * Sets up event listeners for day enable/disable checkboxes.
 */
function setupDayToggles() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        
        if (checkbox && row) {
            // Remove existing listener to avoid duplicates
            checkbox.removeEventListener('change', checkbox._toggleHandler);
            
            // Create and store handler
            checkbox._toggleHandler = function() {
                if (this.checked) {
                    row.classList.remove('disabled');
                } else {
                    row.classList.add('disabled');
                }
            };
            
            checkbox.addEventListener('change', checkbox._toggleHandler);
        }
    });
}

/**
 * Collects availability data from the schedule UI.
 * 
 * @returns {Object} Availability object with day keys
 */
function collectAvailability() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const availability = {};

    days.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        
        if (checkbox && row) {
            availability[day] = {
                enabled: checkbox.checked,
                start_time: row.querySelector('.start-time').value,
                end_time: row.querySelector('.end-time').value
            };
        }
    });

    return availability;
}

/**
 * Validates the availability schedule.
 * 
 * @param {Object} availability - The availability object to validate
 * @returns {Object} { valid: boolean, message: string }
 */
function validateAvailability(availability) {
    // Check if at least one day is enabled
    const enabledDays = Object.values(availability).filter(day => day.enabled);
    if (enabledDays.length === 0) {
        return { valid: false, message: 'Please enable at least one day for availability.' };
    }

    // Check that end time is after start time for enabled days
    for (const [day, config] of Object.entries(availability)) {
        if (config.enabled) {
            if (config.start_time >= config.end_time) {
                return { 
                    valid: false, 
                    message: `${day.charAt(0).toUpperCase() + day.slice(1)}: End time must be after start time.` 
                };
            }
        }
    }

    return { valid: true, message: '' };
}

/**
 * Saves the availability schedule to the database.
 */
async function saveAvailability() {
    console.log('[Settings] Saving availability');
    
    if (!currentHutId || !currentUserId) {
        showNotification('Unable to save - no hut found', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('save-availability-btn');
    const originalText = saveBtn?.textContent || 'Save Availability';
    
    // Collect and validate availability
    const availability = collectAvailability();
    const validation = validateAvailability(availability);
    
    if (!validation.valid) {
        showNotification(validation.message, 'error');
        return;
    }
    
    // Disable button
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const { error } = await supabaseClient
            .from('scout_huts')
            .update({ availability })
            .eq('id', currentHutId);
        
        if (error) {
            throw error;
        }
        
        showNotification('Availability saved successfully', 'success');
        console.log('[Settings] Availability saved');
        
    } catch (err) {
        console.error('[Settings] Error saving availability:', err);
        showNotification('Failed to save availability', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }
}

// Quick set functions for availability
function setWeekdaysOnly() {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const weekends = ['saturday', 'sunday'];
    
    weekdays.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = true;
        if (row) row.classList.remove('disabled');
    });
    
    weekends.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = false;
        if (row) row.classList.add('disabled');
    });
}

function setWeekendsOnly() {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const weekends = ['saturday', 'sunday'];
    
    weekdays.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = false;
        if (row) row.classList.add('disabled');
    });
    
    weekends.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = true;
        if (row) row.classList.remove('disabled');
    });
}

function setAllDays() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = true;
        if (row) row.classList.remove('disabled');
    });
}

function clearAllDays() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const checkbox = document.getElementById(`${day}-enabled`);
        const row = document.querySelector(`[data-day="${day}"]`);
        if (checkbox) checkbox.checked = false;
        if (row) row.classList.add('disabled');
    });
}

function copyTimesToAll(sourceDay) {
    const sourceRow = document.querySelector(`[data-day="${sourceDay}"]`);
    if (!sourceRow) return;

    const sourceStart = sourceRow.querySelector('.start-time').value;
    const sourceEnd = sourceRow.querySelector('.end-time').value;

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const row = document.querySelector(`[data-day="${day}"]`);
        if (row) {
            row.querySelector('.start-time').value = sourceStart;
            row.querySelector('.end-time').value = sourceEnd;
        }
    });

    showNotification('Times copied to all days', 'success');
}

// =============================================================================
// PART 2C: WEEKLY SESSIONS PANEL
// =============================================================================

/**
 * Loads the Weekly Sessions panel data.
 * Displays scout group session schedules.
 */
async function loadSessionsPanel() {
    console.log('[Settings] Loading sessions panel');
    
    if (!currentUserId) return;
    
    const noHutEl = document.getElementById('sessions-no-hut');
    const settingsEl = document.getElementById('sessions-settings');
    
    // Check if user has a hut
    if (!currentHutId) {
        // Show no hut message
        if (noHutEl) noHutEl.style.display = 'block';
        if (settingsEl) settingsEl.style.display = 'none';
        console.log('[Settings] No hut found for sessions panel');
        return;
    }
    
    // Show settings, hide no hut message
    if (noHutEl) noHutEl.style.display = 'none';
    if (settingsEl) settingsEl.style.display = 'block';
    
    try {
        // Get hut weekly sessions data
        const { data: hut, error } = await supabaseClient
            .from('scout_huts')
            .select('weekly_sessions')
            .eq('id', currentHutId)
            .single();
        
        if (error) {
            console.error('[Settings] Error loading sessions:', error);
            return;
        }
        
        // Populate the sessions UI
        if (hut?.weekly_sessions) {
            populateWeeklySessions(hut.weekly_sessions);
        } else {
            // Default all to disabled
            const groups = ['squirrels', 'beavers', 'cubs', 'scouts'];
            groups.forEach(group => {
                const session = document.querySelector(`[data-group="${group}"]`);
                if (session) session.classList.add('disabled');
            });
        }
        
        // Set up group toggle listeners
        setupGroupToggles();
        
        console.log('[Settings] Sessions panel loaded');
        
    } catch (err) {
        console.error('[Settings] Error loading sessions panel:', err);
    }
}

/**
 * Populates the weekly sessions UI with existing data.
 * 
 * @param {Object} sessions - The weekly_sessions object from the database
 */
function populateWeeklySessions(sessions) {
    const groups = ['squirrels', 'beavers', 'cubs', 'scouts'];
    
    groups.forEach(group => {
        const groupConfig = sessions[group];
        const checkbox = document.getElementById(`${group}-enabled`);
        const session = document.querySelector(`[data-group="${group}"]`);
        
        if (checkbox && session) {
            if (groupConfig) {
                checkbox.checked = groupConfig.enabled || false;
                document.getElementById(`${group}-day`).value = groupConfig.day || '';
                document.getElementById(`${group}-start`).value = groupConfig.start_time || '';
                document.getElementById(`${group}-end`).value = groupConfig.end_time || '';
            } else {
                checkbox.checked = false;
            }
            
            // Update session disabled state
            if (checkbox.checked) {
                session.classList.remove('disabled');
            } else {
                session.classList.add('disabled');
            }
        }
    });
}

/**
 * Sets up event listeners for group session enable/disable checkboxes.
 */
function setupGroupToggles() {
    const groups = ['squirrels', 'beavers', 'cubs', 'scouts'];
    
    groups.forEach(group => {
        const checkbox = document.getElementById(`${group}-enabled`);
        const session = document.querySelector(`[data-group="${group}"]`);
        
        if (checkbox && session) {
            // Remove existing listener to avoid duplicates
            checkbox.removeEventListener('change', checkbox._toggleHandler);
            
            // Create and store handler
            checkbox._toggleHandler = function() {
                if (this.checked) {
                    session.classList.remove('disabled');
                } else {
                    session.classList.add('disabled');
                }
            };
            
            checkbox.addEventListener('change', checkbox._toggleHandler);
        }
    });
}

/**
 * Collects weekly sessions data from the UI.
 * 
 * @returns {Object} Weekly sessions object with group keys
 */
function collectWeeklySessions() {
    const groups = ['squirrels', 'beavers', 'cubs', 'scouts'];
    const sessions = {};

    groups.forEach(group => {
        const checkbox = document.getElementById(`${group}-enabled`);
        
        if (checkbox) {
            sessions[group] = {
                enabled: checkbox.checked,
                day: document.getElementById(`${group}-day`).value,
                start_time: document.getElementById(`${group}-start`).value,
                end_time: document.getElementById(`${group}-end`).value
            };
        }
    });

    return sessions;
}

/**
 * Validates the weekly sessions.
 * 
 * @param {Object} sessions - The sessions object to validate
 * @returns {Object} { valid: boolean, message: string }
 */
function validateWeeklySessions(sessions) {
    const groupNames = {
        squirrels: 'Squirrels',
        beavers: 'Beavers',
        cubs: 'Cubs',
        scouts: 'Scouts'
    };

    for (const [group, config] of Object.entries(sessions)) {
        if (config.enabled) {
            if (!config.day) {
                return { 
                    valid: false, 
                    message: `${groupNames[group]}: Please select a day.` 
                };
            }
            if (!config.start_time || !config.end_time) {
                return { 
                    valid: false, 
                    message: `${groupNames[group]}: Please set start and end times.` 
                };
            }
            if (config.start_time >= config.end_time) {
                return { 
                    valid: false, 
                    message: `${groupNames[group]}: End time must be after start time.` 
                };
            }
        }
    }

    return { valid: true, message: '' };
}

/**
 * Saves the weekly sessions to the database.
 */
async function saveWeeklySessions() {
    console.log('[Settings] Saving weekly sessions');
    
    if (!currentHutId || !currentUserId) {
        showNotification('Unable to save - no hut found', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('save-sessions-btn');
    const originalText = saveBtn?.textContent || 'Save Sessions';
    
    // Collect and validate sessions
    const sessions = collectWeeklySessions();
    const validation = validateWeeklySessions(sessions);
    
    if (!validation.valid) {
        showNotification(validation.message, 'error');
        return;
    }
    
    // Disable button
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const { error } = await supabaseClient
            .from('scout_huts')
            .update({ weekly_sessions: sessions })
            .eq('id', currentHutId);
        
        if (error) {
            throw error;
        }
        
        showNotification('Weekly sessions saved successfully', 'success');
        console.log('[Settings] Weekly sessions saved');
        
    } catch (err) {
        console.error('[Settings] Error saving weekly sessions:', err);
        showNotification('Failed to save weekly sessions', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }
}

// =============================================================================
// PART 3: CALENDAR CONNECTION
// =============================================================================

/**
 * Loads the connected state UI and data.
 * Shows connected email, loads calendars, and sync settings.
 * 
 * @param {string} userId - The user's ID
 */
async function loadConnectedState(userId) {
    console.log('[Settings] Loading connected state for user:', userId);
    
    try {
        // Get user's Google email from tokens or profile
        let googleEmail = 'your Google account';
        
        // Try to get email from user profile
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user?.email) {
            googleEmail = user.email;
        }
        
        // Update connection UI (shows calendar is connected)
        updateConnectionUI(true, googleEmail);
        
        // IMPORTANT: Set sync toggle to OFF by default before loading settings
        // This ensures we don't show sync as enabled if loadSyncSettings fails
        const syncToggle = document.getElementById('sync-toggle');
        const syncOptions = document.getElementById('sync-options');
        if (syncToggle) {
            syncToggle.checked = false;
        }
        if (syncOptions) {
            syncOptions.style.display = 'none';
        }
        
        // Load user's Google Calendars
        await loadUserCalendars(userId);
        
        // Load current sync settings from hut (will set toggle to correct state)
        await loadSyncSettings();
        
        // Load sync history
        await loadSyncHistory(currentHutId);
        
        // If sync is enabled, start auto-sync
        if (syncToggle && syncToggle.checked && currentHutId) {
            startAutoSync(currentHutId, userId);
        }
        
        console.log('[Settings] Connected state loaded successfully');
        
    } catch (err) {
        console.error('[Settings] Error loading connected state:', err);
        updateConnectionUI(false);
    }
}

/**
 * Updates the connection status UI.
 * 
 * @param {boolean} connected - Whether the user is connected
 * @param {string} email - The connected email address
 */
function updateConnectionUI(connected, email = '') {
    const indicator = document.getElementById('status-indicator');
    const mainText = document.getElementById('status-text-main');
    const subText = document.getElementById('status-text-sub');
    const notConnectedState = document.getElementById('not-connected-state');
    const connectedState = document.getElementById('connected-state');
    const syncConfigCard = document.getElementById('sync-config-card');
    const syncHistoryCard = document.getElementById('sync-history-card');
    
    if (connected) {
        // Update status indicator
        if (indicator) {
            indicator.classList.remove('disconnected');
            indicator.classList.add('connected');
        }
        if (mainText) mainText.textContent = `Connected as ${email}`;
        if (subText) subText.textContent = 'Your Google Calendar is linked';
        
        // Show/hide appropriate states
        if (notConnectedState) notConnectedState.style.display = 'none';
        if (connectedState) connectedState.style.display = 'block';
        if (syncConfigCard) syncConfigCard.style.display = 'block';
        if (syncHistoryCard) syncHistoryCard.style.display = 'block';
    } else {
        // Update status indicator
        if (indicator) {
            indicator.classList.remove('connected');
            indicator.classList.add('disconnected');
        }
        if (mainText) mainText.textContent = 'Not connected';
        if (subText) subText.textContent = 'Connect your Google account to enable sync';
        
        // Show/hide appropriate states
        if (notConnectedState) notConnectedState.style.display = 'block';
        if (connectedState) connectedState.style.display = 'none';
        if (syncConfigCard) syncConfigCard.style.display = 'none';
        if (syncHistoryCard) syncHistoryCard.style.display = 'none';
    }
}

/**
 * Loads the user's Google Calendars into the dropdown.
 * 
 * @param {string} userId - The user's ID
 */
async function loadUserCalendars(userId) {
    console.log('[Settings] Loading user calendars');
    
    const calendarSelect = document.getElementById('calendar-select');
    if (!calendarSelect) return;
    
    try {
        // Get access token
        const accessToken = await getCalendarTokens(userId);
        if (!accessToken) {
            calendarSelect.innerHTML = '<option value="">Please reconnect Google Calendar</option>';
            return;
        }
        
        // Fetch calendars from Google
        const calendars = await listUserCalendars(accessToken);
        
        if (!calendars || calendars.length === 0) {
            calendarSelect.innerHTML = '<option value="">No calendars found</option>';
            return;
        }
        
        // Clear and populate dropdown
        calendarSelect.innerHTML = '';
        
        calendars.forEach(cal => {
            const option = document.createElement('option');
            option.value = cal.id;
            option.textContent = cal.primary ? `${cal.summary} (Primary)` : cal.summary;
            calendarSelect.appendChild(option);
        });
        
        // Set current selection if configured, or auto-select primary calendar
        if (currentHutId) {
            const { data: hut } = await supabaseClient
                .from('scout_huts')
                .select('google_calendar_id')
                .eq('id', currentHutId)
                .single();
            
            if (hut?.google_calendar_id) {
                calendarSelect.value = hut.google_calendar_id;
            } else {
                // No calendar configured yet - auto-select and save the primary calendar
                // (or first available if no primary)
                const primaryCalendar = calendars.find(cal => cal.primary) || calendars[0];
                if (primaryCalendar) {
                    calendarSelect.value = primaryCalendar.id;
                    
                    // Save the selection to the database
                    console.log('[Settings] Auto-selecting primary calendar:', primaryCalendar.id);
                    const { error } = await supabaseClient
                        .from('scout_huts')
                        .update({ google_calendar_id: primaryCalendar.id })
                        .eq('id', currentHutId);
                    
                    if (error) {
                        console.error('[Settings] Error auto-saving calendar selection:', error);
                    } else {
                        console.log('[Settings] Auto-saved calendar selection to hut');
                    }
                }
            }
        }
        
        console.log('[Settings] Loaded', calendars.length, 'calendars');
        
    } catch (err) {
        console.error('[Settings] Error loading calendars:', err);
        calendarSelect.innerHTML = '<option value="">Error loading calendars</option>';
    }
}

/**
 * Loads sync settings from the hut configuration.
 */
async function loadSyncSettings() {
    // Get UI elements
    const syncToggle = document.getElementById('sync-toggle');
    const syncOptions = document.getElementById('sync-options');
    
    if (!currentHutId) {
        console.log('[Settings] No hut ID, setting sync toggle to disabled');
        // No hut means sync should be off
        if (syncToggle) {
            syncToggle.checked = false;
        }
        if (syncOptions) {
            syncOptions.style.display = 'none';
        }
        return;
    }
    
    console.log('[Settings] Loading sync settings for hut:', currentHutId);
    
    try {
        const { data: hut, error } = await supabaseClient
            .from('scout_huts')
            .select('sync_enabled, sync_direction, google_calendar_id, last_sync_at')
            .eq('id', currentHutId)
            .single();
        
        if (error) {
            console.error('[Settings] Error loading hut sync settings:', error);
            // On error, default to sync disabled
            if (syncToggle) {
                syncToggle.checked = false;
            }
            if (syncOptions) {
                syncOptions.style.display = 'none';
            }
            return;
        }
        
        // Update sync toggle - explicitly check for true, default to false
        const syncEnabled = hut.sync_enabled === true;
        console.log('[Settings] Sync enabled from database:', syncEnabled);
        
        if (syncToggle) {
            syncToggle.checked = syncEnabled;
        }
        
        if (syncOptions) {
            syncOptions.style.display = syncEnabled ? 'block' : 'none';
        }
        
        // Update sync direction
        if (hut.sync_direction) {
            const directionRadio = document.querySelector(`input[name="sync-direction"][value="${hut.sync_direction}"]`);
            if (directionRadio) {
                directionRadio.checked = true;
            }
        }
        
        // Update direction info boxes
        updateSyncDirectionInfoBoxes();
        
        // Update last sync info
        if (hut.last_sync_at) {
            updateLastSyncDisplay(hut.last_sync_at);
        }
        
        console.log('[Settings] Sync settings loaded, sync_enabled:', syncEnabled);
        
    } catch (err) {
        console.error('[Settings] Error loading sync settings:', err);
        // On error, default to sync disabled
        if (syncToggle) {
            syncToggle.checked = false;
        }
        if (syncOptions) {
            syncOptions.style.display = 'none';
        }
    }
}

/**
 * Handles the Connect Calendar button click.
 * Initiates Google OAuth flow with calendar permissions.
 * This is where users grant Google Calendar access (not during sign-up).
 */
async function handleConnectCalendar() {
    console.log('[Settings] Connect calendar clicked');
    
    // Show confirmation modal
    const confirmed = confirm(
        'You will be redirected to grant calendar access.\n\n' +
        'This will allow Scout Bookings to read and write to your Google Calendar.'
    );
    
    if (!confirmed) {
        console.log('[Settings] User cancelled calendar connection');
        return;
    }
    
    const connectBtn = document.getElementById('connect-calendar-btn');
    if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
    }
    
    try {
        // Set flag to indicate we're initiating OAuth
        // This prevents re-saving tokens after disconnect when session still has provider tokens
        sessionStorage.setItem('pendingCalendarOAuth', 'true');
        
        // Get current user's email to use as login hint
        // This skips the account selection screen since they're already logged in
        const { data: { user } } = await supabaseClient.auth.getUser();
        const userEmail = user?.email;
        
        // Initiate Google OAuth with calendar scope
        // Request offline access and force consent to ensure we get refresh token
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
                redirectTo: window.location.href,
                skipBrowserRedirect: false,
                queryParams: {
                    // Request offline access to get refresh token for background sync
                    access_type: 'offline',
                    // Use login_hint to skip account selection (user is already logged in)
                    // Only show consent for the new calendar permissions
                    login_hint: userEmail,
                    prompt: 'consent'
                }
            }
        });
        
        if (error) {
            console.error('[Settings] OAuth error:', error);
            showNotification('Failed to connect Google Calendar: ' + error.message, 'error');
            sessionStorage.removeItem('pendingCalendarOAuth');
            
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect Google Calendar';
            }
            return;
        }
        
        // If we have a URL but redirect didn't happen automatically, navigate manually
        if (data?.url) {
            console.log('[Settings] Redirecting to OAuth URL:', data.url);
            window.location.href = data.url;
        } else {
            console.error('[Settings] No OAuth URL returned');
            showNotification('Failed to initiate Google sign-in', 'error');
            sessionStorage.removeItem('pendingCalendarOAuth');
            
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect Google Calendar';
            }
        }
        
    } catch (err) {
        console.error('[Settings] Error connecting calendar:', err);
        showNotification('Failed to connect Google Calendar', 'error');
        
        if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect Google Calendar';
        }
    }
}

/**
 * Handles the Disconnect Calendar button click.
 * Removes tokens, disables sync, and clears all synced event data.
 */
async function handleDisconnectCalendar() {
    console.log('[Settings] Disconnect calendar clicked');
    
    const confirmed = confirm(
        'Disconnect Google Calendar?\n\n' +
        'This will disable calendar sync, remove the connection to your Google account, ' +
        'and delete all synced Google Calendar events from Scout Bookings.'
    );
    
    if (!confirmed) {
        console.log('[Settings] User cancelled disconnect');
        return;
    }
    
    const disconnectBtn = document.getElementById('disconnect-calendar-btn');
    if (disconnectBtn) {
        disconnectBtn.disabled = true;
        disconnectBtn.textContent = 'Disconnecting...';
    }
    
    try {
        // Stop auto-sync
        stopAutoSync();
        
        // Delete all synced events for this hut (both directions)
        // This removes all Google Calendar event data from Scout Bookings
        if (currentHutId) {
            const { error: syncedEventsError } = await supabaseClient
                .from('synced_events')
                .delete()
                .eq('hut_id', currentHutId);
            
            if (syncedEventsError) {
                console.error('[Settings] Error deleting synced events:', syncedEventsError);
                // Continue with disconnect even if this fails
            } else {
                console.log('[Settings] Deleted all synced events for hut');
            }
        }
        
        // Disable sync on hut and clear calendar ID
        if (currentHutId) {
            await supabaseClient
                .from('scout_huts')
                .update({ 
                    sync_enabled: false,
                    google_calendar_id: null,
                    last_sync_at: null
                })
                .eq('id', currentHutId);
        }
        
        // Remove calendar tokens
        const result = await removeCalendarTokens(currentUserId);
        
        if (result.success) {
            // Update UI to disconnected state
            updateConnectionUI(false);
            showNotification('Google Calendar disconnected', 'success');
            console.log('[Settings] Calendar disconnected successfully');
        } else {
            throw new Error(result.error || 'Failed to remove tokens');
        }
        
    } catch (err) {
        console.error('[Settings] Error disconnecting calendar:', err);
        showNotification('Failed to disconnect calendar', 'error');
    } finally {
        if (disconnectBtn) {
            disconnectBtn.disabled = false;
            disconnectBtn.textContent = 'Disconnect';
        }
    }
}

// =============================================================================
// PART 4: SYNC CONFIGURATION
// =============================================================================

/**
 * Handles the sync toggle change.
 * Enables or disables calendar sync.
 * 
 * @param {boolean} enabled - Whether sync is being enabled
 */
async function handleSyncToggle(enabled) {
    console.log('[Settings] Sync toggle changed:', enabled);
    
    const syncOptions = document.getElementById('sync-options');
    
    if (enabled) {
        // Validate calendar is selected
        const calendarSelect = document.getElementById('calendar-select');
        if (!calendarSelect || !calendarSelect.value) {
            showNotification('Please select a calendar first', 'error');
            const syncToggle = document.getElementById('sync-toggle');
            if (syncToggle) syncToggle.checked = false;
            return;
        }
        
        // Show sync options
        if (syncOptions) syncOptions.style.display = 'block';
        
        // Update hut settings
        if (currentHutId) {
            const { error } = await supabaseClient
                .from('scout_huts')
                .update({ 
                    sync_enabled: true,
                    google_calendar_id: calendarSelect.value
                })
                .eq('id', currentHutId);
            
            if (error) {
                console.error('[Settings] Error enabling sync:', error);
                showNotification('Failed to enable sync', 'error');
                return;
            }
        }
        
        // Trigger immediate sync
        await handleSyncNow();
        
        // Start auto-sync
        startAutoSync(currentHutId, currentUserId);
        
        showNotification('Calendar sync enabled', 'success');
        
    } else {
        // Confirm disable
        const confirmed = confirm('Disable calendar sync? Your existing synced events will remain.');
        
        if (!confirmed) {
            const syncToggle = document.getElementById('sync-toggle');
            if (syncToggle) syncToggle.checked = true;
            return;
        }
        
        // Update hut settings first
        if (currentHutId) {
            const { error } = await supabaseClient
                .from('scout_huts')
                .update({ sync_enabled: false })
                .eq('id', currentHutId);
            
            if (error) {
                console.error('[Settings] Error disabling sync:', error);
                showNotification('Failed to disable sync', 'error');
                // Revert toggle on error
                const syncToggle = document.getElementById('sync-toggle');
                if (syncToggle) syncToggle.checked = true;
                return;
            }
            
            console.log('[Settings] Sync disabled in database for hut:', currentHutId);
        }
        
        // Hide sync options
        if (syncOptions) syncOptions.style.display = 'none';
        
        // Stop auto-sync
        stopAutoSync();
        
        showNotification('Calendar sync disabled', 'info');
    }
}

/**
 * Handles calendar selection change.
 * Updates the hut's Google Calendar ID.
 * 
 * @param {string} calendarId - The selected calendar ID
 */
async function handleCalendarSelect(calendarId) {
    console.log('[Settings] Calendar selected:', calendarId);
    
    if (!currentHutId) {
        console.error('[Settings] No hut ID available');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('scout_huts')
            .update({ google_calendar_id: calendarId })
            .eq('id', currentHutId);
        
        if (error) {
            console.error('[Settings] Error updating calendar selection:', error);
            showNotification('Failed to update calendar', 'error');
            return;
        }
        
        // If sync is enabled, trigger immediate sync
        const syncToggle = document.getElementById('sync-toggle');
        if (syncToggle && syncToggle.checked) {
            await handleSyncNow();
        }
        
        showNotification('Calendar updated', 'success');
        
    } catch (err) {
        console.error('[Settings] Error selecting calendar:', err);
        showNotification('Failed to update calendar', 'error');
    }
}

/**
 * Handles sync direction change.
 * Updates the hut's sync direction setting.
 * 
 * @param {string} direction - The sync direction ('both', 'from_google', 'to_google')
 */
async function handleSyncDirectionChange(direction) {
    console.log('[Settings] Sync direction changed:', direction);
    
    // Update info boxes
    updateSyncDirectionInfoBoxes();
    
    if (!currentHutId) {
        console.error('[Settings] No hut ID available');
        return;
    }
    
    try {
        const { error } = await supabaseClient
            .from('scout_huts')
            .update({ sync_direction: direction })
            .eq('id', currentHutId);
        
        if (error) {
            console.error('[Settings] Error updating sync direction:', error);
            showNotification('Failed to update sync direction', 'error');
            return;
        }
        
        // Show explanation
        let explanation = '';
        switch (direction) {
            case 'both':
                explanation = 'Two-way sync: Events sync in both directions';
                break;
            case 'from_google':
                explanation = 'Import only: Google events will block booking times';
                break;
            case 'to_google':
                explanation = 'Export only: Bookings will appear in Google Calendar';
                break;
        }
        
        showNotification(explanation, 'info');
        
        // If sync is enabled, trigger immediate sync
        const syncToggle = document.getElementById('sync-toggle');
        if (syncToggle && syncToggle.checked) {
            await handleSyncNow();
        }
        
    } catch (err) {
        console.error('[Settings] Error changing sync direction:', err);
        showNotification('Failed to update sync direction', 'error');
    }
}

/**
 * Updates the sync direction info boxes based on current selection.
 */
function updateSyncDirectionInfoBoxes() {
    const direction = document.querySelector('input[name="sync-direction"]:checked')?.value || 'both';
    const importBox = document.getElementById('info-import');
    const exportBox = document.getElementById('info-export');
    
    if (importBox) {
        importBox.classList.toggle('hidden', direction === 'to_google');
    }
    if (exportBox) {
        exportBox.classList.toggle('hidden', direction === 'from_google');
    }
}

// =============================================================================
// PART 5: MANUAL SYNC
// =============================================================================

/**
 * Handles the Sync Now button click.
 * Performs a manual sync based on current settings.
 */
async function handleSyncNow() {
    console.log('[Settings] Manual sync requested');
    
    if (isSyncing) {
        console.log('[Settings] Sync already in progress');
        return;
    }
    
    if (!currentHutId || !currentUserId) {
        console.error('[Settings] Missing hut ID or user ID');
        showNotification('Unable to sync - missing configuration', 'error');
        return;
    }
    
    const syncNowBtn = document.getElementById('sync-now-btn');
    const spinner = document.getElementById('sync-spinner');
    const lastSyncInfo = document.getElementById('last-sync-info');
    
    // Update UI - disable button, show spinner
    if (syncNowBtn) {
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';
    }
    if (spinner) spinner.classList.remove('hidden');
    
    isSyncing = true;
    
    try {
        // Get hut settings
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('google_calendar_id, sync_direction')
            .eq('id', currentHutId)
            .single();
        
        if (hutError || !hut) {
            throw new Error('Failed to get hut settings');
        }
        
        if (!hut.google_calendar_id) {
            throw new Error('No calendar selected');
        }
        
        // Get access token
        const accessToken = await getCalendarTokens(currentUserId);
        if (!accessToken) {
            throw new Error('No valid access token - please reconnect Google Calendar');
        }
        
        const direction = hut.sync_direction || 'both';
        let fromGoogleResult = { imported: 0, updated: 0, deleted: 0 };
        let toGoogleResult = { created: 0, updated: 0, deleted: 0 };
        
        // Run sync based on direction
        if (direction === 'both' || direction === 'from_google') {
            console.log('[Settings] Syncing FROM Google Calendar');
            fromGoogleResult = await syncFromGoogleCalendar(currentHutId, accessToken, hut.google_calendar_id);
            
            if (!fromGoogleResult.success) {
                console.error('[Settings] Sync from Google failed:', fromGoogleResult.error);
            }
        }
        
        if (direction === 'both' || direction === 'to_google') {
            console.log('[Settings] Syncing TO Google Calendar');
            toGoogleResult = await syncToGoogleCalendar(currentHutId, accessToken, hut.google_calendar_id);
            
            if (!toGoogleResult.success) {
                console.error('[Settings] Sync to Google failed:', toGoogleResult.error);
            }
        }
        
        // Update last_sync_at
        await supabaseClient
            .from('scout_huts')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', currentHutId);
        
        // Build results message
        const importCount = fromGoogleResult.imported + fromGoogleResult.updated;
        const exportCount = toGoogleResult.created + toGoogleResult.updated;
        
        let resultMessage = 'Sync complete.';
        const parts = [];
        
        if (direction === 'both' || direction === 'from_google') {
            parts.push(`Imported ${importCount} event${importCount !== 1 ? 's' : ''}`);
        }
        if (direction === 'both' || direction === 'to_google') {
            parts.push(`Exported ${exportCount} booking${exportCount !== 1 ? 's' : ''}`);
        }
        
        if (parts.length > 0) {
            resultMessage = `Sync complete. ${parts.join(', ')}`;
        }
        
        // Update last sync display
        updateLastSyncDisplay(new Date().toISOString(), {
            imported: importCount,
            exported: exportCount
        });
        
        // Refresh sync history
        await loadSyncHistory(currentHutId);
        
        showNotification(resultMessage, 'success');
        console.log('[Settings] Manual sync completed:', resultMessage);
        
    } catch (err) {
        console.error('[Settings] Sync error:', err);
        showNotification(err.message || 'Sync failed', 'error');
    } finally {
        // Reset UI
        isSyncing = false;
        
        if (syncNowBtn) {
            syncNowBtn.disabled = false;
            syncNowBtn.textContent = 'Sync Now';
        }
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * Updates the last sync display with time and results.
 * 
 * @param {string} timestamp - ISO timestamp of last sync
 * @param {Object} results - Sync results with imported/exported counts
 */
function updateLastSyncDisplay(timestamp, results = null) {
    const timeEl = document.getElementById('last-sync-time');
    const resultsEl = document.getElementById('last-sync-results');
    
    if (timeEl && timestamp) {
        const timeAgo = getTimeAgo(new Date(timestamp));
        timeEl.textContent = `Last synced: ${timeAgo}`;
    }
    
    if (resultsEl && results) {
        const parts = [];
        if (results.imported !== undefined) {
            parts.push(`Imported ${results.imported} event${results.imported !== 1 ? 's' : ''}`);
        }
        if (results.exported !== undefined) {
            parts.push(`Exported ${results.exported} booking${results.exported !== 1 ? 's' : ''}`);
        }
        resultsEl.textContent = parts.join(', ') || 'Sync completed';
    }
}

// =============================================================================
// PART 6: TWO-WAY SYNC EXECUTION (Uses calendar.js functions)
// =============================================================================

// Note: syncFromGoogleCalendar and syncToGoogleCalendar are defined in calendar.js
// They are called from handleSyncNow() and performAutoSync()

// =============================================================================
// PART 7: AUTOMATIC BACKGROUND SYNC
// =============================================================================

/**
 * Starts automatic background sync.
 * Runs an initial sync and sets up recurring sync every 15 minutes.
 * 
 * @param {string} hutId - The hut ID
 * @param {string} userId - The user ID
 */
function startAutoSync(hutId, userId) {
    console.log('[Settings] Starting auto-sync (every 15 minutes)');
    
    // Clear any existing interval
    stopAutoSync();
    
    // Run initial sync (silently)
    performAutoSync(hutId, userId);
    
    // Set up recurring sync
    autoSyncInterval = setInterval(() => {
        performAutoSync(hutId, userId);
    }, AUTO_SYNC_INTERVAL_MS);
    
    console.log('[Settings] Auto-sync started with interval ID:', autoSyncInterval);
}

/**
 * Stops automatic background sync.
 */
function stopAutoSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
        console.log('[Settings] Auto-sync stopped');
    }
}

/**
 * Performs an automatic background sync.
 * Runs silently without UI updates (except for errors).
 * 
 * @param {string} hutId - The hut ID
 * @param {string} userId - The user ID
 */
async function performAutoSync(hutId, userId) {
    console.log('[Settings] Performing auto-sync');
    
    if (!hutId || !userId) {
        console.log('[Settings] Auto-sync skipped - missing hut or user ID');
        return;
    }
    
    try {
        // Get hut sync settings
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('sync_enabled, google_calendar_id, sync_direction')
            .eq('id', hutId)
            .single();
        
        if (hutError || !hut) {
            console.error('[Settings] Auto-sync: Failed to get hut settings');
            return;
        }
        
        // Check if sync is enabled
        if (!hut.sync_enabled) {
            console.log('[Settings] Auto-sync skipped - sync not enabled');
            return;
        }
        
        if (!hut.google_calendar_id) {
            console.log('[Settings] Auto-sync skipped - no calendar configured');
            return;
        }
        
        // Get access token (refresh if needed)
        const accessToken = await getCalendarTokens(userId);
        if (!accessToken) {
            console.error('[Settings] Auto-sync: No valid access token');
            return;
        }
        
        const direction = hut.sync_direction || 'both';
        
        // Run sync based on direction
        if (direction === 'both' || direction === 'from_google') {
            const fromResult = await syncFromGoogleCalendar(hutId, accessToken, hut.google_calendar_id);
            console.log('[Settings] Auto-sync FROM Google:', fromResult);
        }
        
        if (direction === 'both' || direction === 'to_google') {
            const toResult = await syncToGoogleCalendar(hutId, accessToken, hut.google_calendar_id);
            console.log('[Settings] Auto-sync TO Google:', toResult);
        }
        
        // Update last_sync_at silently
        await supabaseClient
            .from('scout_huts')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', hutId);
        
        console.log('[Settings] Auto-sync completed');
        
    } catch (err) {
        // Handle errors gracefully - don't interrupt user
        console.error('[Settings] Auto-sync error:', err);
    }
}

// =============================================================================
// PART 8: SYNC HISTORY DISPLAY
// =============================================================================

/**
 * Loads and displays sync history for a hut.
 * 
 * @param {string} hutId - The hut ID
 */
async function loadSyncHistory(hutId) {
    console.log('[Settings] Loading sync history for hut:', hutId);
    
    const historyContainer = document.getElementById('sync-history');
    if (!historyContainer) return;
    
    if (!hutId) {
        historyContainer.innerHTML = '<div class="sync-history-empty">No sync activity yet</div>';
        return;
    }
    
    try {
        // Query synced_events for this hut
        const { data: events, error } = await supabaseClient
            .from('synced_events')
            .select('*')
            .eq('hut_id', hutId)
            .order('last_synced_at', { ascending: false })
            .limit(20);
        
        if (error) {
            console.error('[Settings] Error loading sync history:', error);
            historyContainer.innerHTML = '<div class="sync-history-empty">No sync activity yet</div>';
            return;
        }
        
        if (!events || events.length === 0) {
            historyContainer.innerHTML = '<div class="sync-history-empty">No sync activity yet</div>';
            return;
        }
        
        // Display sync history
        displaySyncHistory(events);
        
    } catch (err) {
        console.error('[Settings] Error loading sync history:', err);
        historyContainer.innerHTML = '<div class="sync-history-empty">No sync activity yet</div>';
    }
}

/**
 * Displays sync history events in the UI.
 * 
 * @param {Array} events - Array of synced event objects
 */
function displaySyncHistory(events) {
    const historyContainer = document.getElementById('sync-history');
    if (!historyContainer) return;
    
    const html = events.map(event => {
        const isFromGoogle = event.event_type === 'google_to_scout';
        const directionClass = isFromGoogle ? 'import' : 'export';
        const directionLabel = isFromGoogle ? 'IN' : 'OUT';
        const directionText = isFromGoogle ? 'From Google' : 'To Google';
        
        const syncedAt = new Date(event.last_synced_at);
        const timeAgo = getTimeAgo(syncedAt);
        const dateStr = syncedAt.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
        
        const title = event.title || 'Untitled Event';
        
        return `
            <div class="sync-history-item">
                <div class="sync-direction-indicator ${directionClass}" title="${directionText}">
                    ${directionLabel}
                </div>
                <div class="sync-history-content">
                    <div class="sync-history-title">${escapeHtml(title)}</div>
                    <div class="sync-history-meta">${dateStr} - ${timeAgo}</div>
                </div>
            </div>
        `;
    }).join('');
    
    historyContainer.innerHTML = html;
}

// =============================================================================
// PART 9: EVENT LISTENERS
// =============================================================================

/**
 * Sets up all event listeners for the settings page.
 */
function setupEventListeners() {
    console.log('[Settings] Setting up event listeners');
    
    // Profile form submission
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileFormSubmit);
    }
    
    // Delete account button
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', handleDeleteAccount);
    }
    
    // Connect calendar button
    const connectBtn = document.getElementById('connect-calendar-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', handleConnectCalendar);
    }
    
    // Disconnect calendar button
    const disconnectBtn = document.getElementById('disconnect-calendar-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', handleDisconnectCalendar);
    }
    
    // Sync toggle
    const syncToggle = document.getElementById('sync-toggle');
    if (syncToggle) {
        syncToggle.addEventListener('change', (e) => {
            handleSyncToggle(e.target.checked);
        });
    }
    
    // Calendar select
    const calendarSelect = document.getElementById('calendar-select');
    if (calendarSelect) {
        calendarSelect.addEventListener('change', (e) => {
            handleCalendarSelect(e.target.value);
        });
    }
    
    // Sync direction radios
    const syncDirectionRadios = document.querySelectorAll('input[name="sync-direction"]');
    syncDirectionRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            handleSyncDirectionChange(e.target.value);
        });
    });
    
    // Sync now button
    const syncNowBtn = document.getElementById('sync-now-btn');
    if (syncNowBtn) {
        syncNowBtn.addEventListener('click', handleSyncNow);
    }
    
    // Manage subscription button
    const manageSubBtn = document.getElementById('manage-subscription-btn');
    if (manageSubBtn) {
        manageSubBtn.addEventListener('click', handleManageSubscription);
    }
    
    // Notification toggles
    const notifyToggles = [
        'notify-booking-created',
        'notify-booking-reminder',
        'notify-booking-cancelled'
    ];
    
    notifyToggles.forEach(id => {
        const toggle = document.getElementById(id);
        if (toggle) {
            toggle.addEventListener('change', saveNotificationSettings);
        }
    });
    
    // Reminder timing select
    const reminderTiming = document.getElementById('reminder-timing');
    if (reminderTiming) {
        reminderTiming.addEventListener('change', saveNotificationSettings);
    }
    
    // Handle page unload - stop auto-sync
    window.addEventListener('beforeunload', () => {
        stopAutoSync();
    });
    
    console.log('[Settings] Event listeners set up');
}

/**
 * Handles the Manage Subscription button click.
 * Opens Stripe billing portal.
 */
async function handleManageSubscription() {
    console.log('[Settings] Manage subscription clicked');
    
    // In production, this would redirect to Stripe billing portal
    // For now, show a placeholder message
    showNotification('Billing portal coming soon', 'info');
}

/**
 * Saves notification settings to the database.
 */
async function saveNotificationSettings() {
    if (!currentUserId) return;
    
    const bookingCreated = document.getElementById('notify-booking-created')?.checked ?? true;
    const bookingReminder = document.getElementById('notify-booking-reminder')?.checked ?? true;
    const bookingCancelled = document.getElementById('notify-booking-cancelled')?.checked ?? true;
    const reminderTiming = document.getElementById('reminder-timing')?.value ?? '2';
    
    const preferences = {
        booking_created: bookingCreated,
        booking_reminder: bookingReminder,
        booking_cancelled: bookingCancelled,
        reminder_days: parseInt(reminderTiming)
    };
    
    console.log('[Settings] Saving notification preferences:', preferences);
    
    try {
        const { error } = await supabaseClient
            .from('user_settings')
            .upsert({
                user_id: currentUserId,
                notification_preferences: preferences,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });
        
        if (error) {
            console.error('[Settings] Error saving notification settings:', error);
            // Don't show error for every toggle change
        } else {
            console.log('[Settings] Notification settings saved');
        }
    } catch (err) {
        console.error('[Settings] Error saving notification settings:', err);
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculates a human-readable "time ago" string.
 * 
 * @param {Date} date - The date to compare
 * @returns {string} Human-readable time ago string
 */
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Gets initials from a name.
 * 
 * @param {string} name - The full name
 * @returns {string} Initials (max 2 characters)
 */
function getInitials(name) {
    if (!name) return '?';
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

/**
 * Capitalizes the first letter of a string.
 * 
 * @param {string} str - The string to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Gets the user's hut from the database.
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<Object|null>} The hut object or null
 */
async function getUserHut(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('scout_huts')
            .select('*')
            .eq('owner_id', userId)
            .single();
        
        if (error) {
            // PGRST116 = no rows returned, which is fine if user hasn't created a hut yet
            if (error.code === 'PGRST116') {
                console.log('[Settings] No hut found for user (this is normal for new users)');
                return null;
            }
            console.error('[Settings] Error getting user hut:', error.message || error.code || JSON.stringify(error));
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('[Settings] Exception getting user hut:', err.message || err);
        return null;
    }
}

// =============================================================================
// DOMCONTENTLOADED
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Settings] DOM loaded, initializing settings page');
    loadSettings();
});

// =============================================================================
// EXPORTS (for global access)
// =============================================================================

if (typeof window !== 'undefined') {
    window.SettingsModule = {
        // Initialization
        loadSettings,
        initializeSidebar,
        
        // Navigation
        handleNavClick,
        showPanel,
        
        // Profile
        loadProfilePanel,
        handleProfileFormSubmit,
        
        // Calendar connection
        handleConnectCalendar,
        handleDisconnectCalendar,
        loadConnectedState,
        
        // Sync
        handleSyncToggle,
        handleSyncNow,
        handleCalendarSelect,
        handleSyncDirectionChange,
        
        // Auto-sync
        startAutoSync,
        stopAutoSync,
        
        // Availability
        loadAvailabilityPanel,
        saveAvailability,
        setWeekdaysOnly,
        setWeekendsOnly,
        setAllDays,
        clearAllDays,
        copyTimesToAll,
        
        // Weekly Sessions
        loadSessionsPanel,
        saveWeeklySessions,
        
        // Team Management
        loadTeamPanel,
        loadTeamMembers,
        loadPendingInvitations,
        openInviteModal,
        closeInviteModal,
        sendInvitation,
        resendInvitation,
        revokeInvitation,
        openEditRoleModal,
        closeEditRoleModal,
        saveRoleChange,
        removeTeamMember,
        
        // Subscription & Upgrade Codes
        loadSubscriptionPanel,
        handleUpgradeCodeSubmit,
        
        // Utilities
        getTimeAgo,
        getInitials
    };
    
    // Global function aliases for compatibility with inline scripts
    // These are called by settings.html's fallback initCalendarSyncUI function
    window.initiateGoogleCalendarAuth = handleConnectCalendar;
    window.disconnectGoogleCalendar = handleDisconnectCalendar;
    window.syncCalendarNow = handleSyncNow;
    window.initCalendarSyncSettings = loadSettings;
    window.getCalendarConnectionStatus = async function(userId) {
        // Check if user has calendar tokens via CalendarSync module
        if (typeof window.CalendarSync?.isGoogleCalendarConnected === 'function') {
            const connected = await window.CalendarSync.isGoogleCalendarConnected(userId);
            return { connected, email: '' };
        }
        return { connected: false, email: '' };
    };
    
    // Global function aliases for availability and sessions
    window.setWeekdaysOnly = setWeekdaysOnly;
    window.setWeekendsOnly = setWeekendsOnly;
    window.setAllDays = setAllDays;
    window.clearAllDays = clearAllDays;
    window.copyTimesToAll = copyTimesToAll;
    window.saveAvailability = saveAvailability;
    window.saveWeeklySessions = saveWeeklySessions;
    
    // Global function aliases for team management (used by onclick handlers)
    window.openEditRoleModal = openEditRoleModal;
    window.removeTeamMember = removeTeamMember;
    window.resendInvitation = resendInvitation;
    window.revokeInvitation = revokeInvitation;
}
