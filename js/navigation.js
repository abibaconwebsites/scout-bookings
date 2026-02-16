/**
 * Shared Dashboard Navigation Component
 * Dynamically injects the navigation bar into logged-in pages.
 * Supports both full navigation (with notifications) and simple navigation.
 */

// =============================================================================
// NAVIGATION HTML TEMPLATES
// =============================================================================

/**
 * Full navigation with notifications dropdown (used on dashboard)
 */
function getFullNavigationHTML() {
    return `
    <nav class="navbar" role="navigation" aria-label="Main navigation">
        <div class="nav-container">
            <a href="dashboard.html" class="logo" aria-label="Scout Bookings Dashboard">Scout Bookings</a>
            <div class="nav-actions">
                <div class="nav-notifications-wrapper">
                    <button class="nav-icon-btn nav-notifications" id="notifications-btn" aria-label="Notifications" onclick="toggleNotificationsDropdown(event)">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                        </svg>
                        <span class="notification-badge" id="notification-badge" style="display: none;">0</span>
                    </button>
                    <div class="notifications-dropdown" id="notifications-dropdown">
                        <div class="notifications-dropdown-header">
                            <span>Pending Bookings</span>
                        </div>
                        <div class="notifications-dropdown-list" id="notifications-dropdown-list">
                            <div class="notifications-empty">No pending bookings</div>
                        </div>
                    </div>
                </div>
                <a href="settings.html" class="nav-icon-btn" aria-label="Settings">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                </a>
                <button onclick="handleLogout()" class="nav-icon-btn" aria-label="Logout">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                    </svg>
                </button>
            </div>
        </div>
    </nav>`;
}

/**
 * Returns the navigation HTML.
 * All logged-in pages now use the same navigation with notifications.
 */
function getNavigationHTML() {
    return getFullNavigationHTML();
}

// =============================================================================
// NAVIGATION INITIALIZATION
// =============================================================================

/**
 * Initializes the dashboard navigation.
 * Call this function on page load to inject the navigation into the page.
 * All logged-in pages use the same navigation with notifications.
 */
function initDashboardNavigation() {
    // Find the navigation placeholder
    const navPlaceholder = document.getElementById('dashboard-nav');
    
    if (!navPlaceholder) {
        console.warn('Navigation placeholder (#dashboard-nav) not found');
        return;
    }
    
    // Insert the navigation HTML
    navPlaceholder.outerHTML = getFullNavigationHTML();
}

// =============================================================================
// NOTIFICATIONS DROPDOWN (for dashboard)
// =============================================================================

/**
 * Toggles the notifications dropdown visibility.
 * @param {Event} event - The click event
 */
function toggleNotificationsDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('active');
    }
}

/**
 * Closes the notifications dropdown when clicking outside.
 */
function closeNotificationsDropdown() {
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('notifications-dropdown');
    const btn = document.getElementById('notifications-btn');
    
    if (dropdown && btn && !dropdown.contains(event.target) && !btn.contains(event.target)) {
        dropdown.classList.remove('active');
    }
});

// Close dropdown on escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeNotificationsDropdown();
    }
});
