/**
 * Scout Bookings utils: shared helpers, DOM helpers, and formatting.
 */

// =============================================================================
// SECURITY HELPERS
// =============================================================================

/**
 * Escapes HTML entities to prevent XSS attacks.
 * Converts special characters to their HTML entity equivalents.
 * 
 * @param {string} text - The text to escape
 * @returns {string|null} The escaped text, or null if input is invalid
 * 
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
function escapeHtml(text) {
    // Validate input - must be a string
    if (typeof text !== 'string') {
        return null;
    }
    
    // Map of characters to their HTML entity equivalents
    const htmlEntities = {
        '&': '&amp;',   // Must be first to avoid double-escaping
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    
    // Replace each special character with its entity
    return text.replace(/[&<>"']/g, char => htmlEntities[char]);
}

// =============================================================================
// DATE/TIME FORMATTING HELPERS
// =============================================================================

/**
 * Formats a date string to UK locale format: "Mon, 9 Feb 2025, 14:30"
 * 
 * @param {string|Date} dateString - The date to format (ISO string or Date object)
 * @returns {string|null} Formatted date string, or null if input is invalid
 * 
 * @example
 * formatDateTime('2025-02-09T14:30:00')
 * // Returns: 'Sun, 9 Feb 2025, 14:30'
 */
function formatDateTime(dateString) {
    // Validate input
    if (!dateString) {
        return null;
    }
    
    // Parse the date
    const date = new Date(dateString);
    
    // Check for invalid date
    if (isNaN(date.getTime())) {
        return null;
    }
    
    // Format options for UK locale
    const options = {
        weekday: 'short',   // Mon, Tue, etc.
        day: 'numeric',     // 9 (no leading zero)
        month: 'short',     // Feb
        year: 'numeric',    // 2025
        hour: '2-digit',    // 14
        minute: '2-digit',  // 30
        hour12: false       // 24-hour format
    };
    
    // Format using UK locale
    return date.toLocaleString('en-GB', options);
}

/**
 * Formats a date string to time only: "14:30"
 * 
 * @param {string|Date} dateString - The date to format (ISO string or Date object)
 * @returns {string|null} Formatted time string (HH:MM), or null if input is invalid
 * 
 * @example
 * formatTime('2025-02-09T14:30:00')
 * // Returns: '14:30'
 */
function formatTime(dateString) {
    // Validate input
    if (!dateString) {
        return null;
    }
    
    // Parse the date
    const date = new Date(dateString);
    
    // Check for invalid date
    if (isNaN(date.getTime())) {
        return null;
    }
    
    // Format options for time only
    const options = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    
    // Format using UK locale
    return date.toLocaleString('en-GB', options);
}

/**
 * Formats a date string to date only: "9 Feb 2025"
 * 
 * @param {string|Date} dateString - The date to format (ISO string or Date object)
 * @returns {string|null} Formatted date string, or null if input is invalid
 * 
 * @example
 * formatDate('2025-02-09T14:30:00')
 * // Returns: '9 Feb 2025'
 */
function formatDate(dateString) {
    // Validate input
    if (!dateString) {
        return null;
    }
    
    // Parse the date
    const date = new Date(dateString);
    
    // Check for invalid date
    if (isNaN(date.getTime())) {
        return null;
    }
    
    // Format options for date only
    const options = {
        day: 'numeric',     // 9 (no leading zero)
        month: 'short',     // Feb
        year: 'numeric'     // 2025
    };
    
    // Format using UK locale
    return date.toLocaleString('en-GB', options);
}

// =============================================================================
// STRING HELPERS
// =============================================================================

/**
 * Converts text to a URL-friendly slug.
 * Converts to lowercase, replaces spaces with hyphens, removes special characters.
 * 
 * @param {string} text - The text to convert to a slug
 * @returns {string|null} URL-friendly slug, or null if input is invalid
 * 
 * @example
 * generateSlug('Scout Hut - Main Building!')
 * // Returns: 'scout-hut-main-building'
 */
function generateSlug(text) {
    // Validate input - must be a non-empty string
    if (typeof text !== 'string' || text.trim() === '') {
        return null;
    }
    
    return text
        .toLowerCase()                      // Convert to lowercase
        .trim()                             // Remove leading/trailing whitespace
        .normalize('NFD')                   // Normalize unicode characters
        .replace(/[\u0300-\u036f]/g, '')    // Remove diacritics (accents)
        .replace(/[^a-z0-9\s-]/g, '')       // Remove special characters
        .replace(/\s+/g, '-')               // Replace spaces with hyphens
        .replace(/-+/g, '-')                // Replace multiple hyphens with single
        .replace(/^-+|-+$/g, '');           // Remove leading/trailing hyphens
}

// =============================================================================
// UI NOTIFICATION HELPERS
// =============================================================================

/**
 * Creates and displays a toast notification.
 * Notification appears in top-right corner and auto-removes after 3 seconds.
 * 
 * @param {string} message - The message to display
 * @param {('success'|'error'|'info')} type - The notification type
 * @returns {HTMLElement|null} The notification element, or null if input is invalid
 * 
 * @example
 * showNotification('Booking saved successfully!', 'success')
 * showNotification('Failed to load data', 'error')
 * showNotification('Please check your email', 'info')
 */
function showNotification(message, type = 'info') {
    // Validate message
    if (typeof message !== 'string' || message.trim() === '') {
        return null;
    }
    
    // Validate type - default to 'info' if invalid
    const validTypes = ['success', 'error', 'info'];
    if (!validTypes.includes(type)) {
        type = 'info';
    }
    
    // Create notification container if it doesn't exist
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Define colors for each type
    const colors = {
        success: { bg: '#10b981', text: '#ffffff' },  // Green
        error: { bg: '#ef4444', text: '#ffffff' },    // Red
        info: { bg: '#3b82f6', text: '#ffffff' }      // Blue
    };
    
    // Apply styles
    notification.style.cssText = `
        padding: 12px 20px;
        border-radius: 6px;
        background-color: ${colors[type].bg};
        color: ${colors[type].text};
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        opacity: 1;
        transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        transform: translateX(0);
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Auto-remove after 3 seconds with fade-out animation
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';
        
        // Remove from DOM after animation completes
        setTimeout(() => {
            notification.remove();
            
            // Remove container if empty
            if (container && container.children.length === 0) {
                container.remove();
            }
        }, 300);
    }, 3000);
    
    return notification;
}

// =============================================================================
// DATE CALCULATION HELPERS
// =============================================================================

/**
 * Calculates the number of nights between two dates.
 * 
 * @param {string|Date} startDate - The start date
 * @param {string|Date} endDate - The end date
 * @returns {number|null} Number of nights, or null if inputs are invalid
 * 
 * @example
 * calculateNights('2025-02-09', '2025-02-12')
 * // Returns: 3
 */
function calculateNights(startDate, endDate) {
    // Validate inputs
    if (!startDate || !endDate) {
        return null;
    }
    
    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check for invalid dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return null;
    }
    
    // Calculate difference in milliseconds
    const diffMs = end.getTime() - start.getTime();
    
    // Convert to days (nights)
    const nights = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Return null if end date is before start date
    if (nights < 0) {
        return null;
    }
    
    return nights;
}

/**
 * Calculates the number of days remaining from now until the end date.
 * 
 * @param {string|Date} endDate - The target end date
 * @returns {number|null} Number of days remaining, or null if input is invalid
 * 
 * @example
 * // If today is 9 Feb 2025
 * getDaysRemaining('2025-02-14')
 * // Returns: 5
 */
function getDaysRemaining(endDate) {
    // Validate input
    if (!endDate) {
        return null;
    }
    
    // Parse end date
    const end = new Date(endDate);
    
    // Check for invalid date
    if (isNaN(end.getTime())) {
        return null;
    }
    
    // Get current date (start of day for accurate calculation)
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Set end date to start of day as well
    end.setHours(0, 0, 0, 0);
    
    // Calculate difference in milliseconds
    const diffMs = end.getTime() - now.getTime();
    
    // Convert to days
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    return days;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates an email address format using regex.
 * 
 * @param {string} email - The email address to validate
 * @returns {boolean} True if valid email format, false otherwise
 * 
 * @example
 * isValidEmail('user@example.com')    // Returns: true
 * isValidEmail('invalid-email')        // Returns: false
 * isValidEmail('user@.com')            // Returns: false
 */
function isValidEmail(email) {
    // Validate input - must be a non-empty string
    if (typeof email !== 'string' || email.trim() === '') {
        return false;
    }
    
    // RFC 5322 compliant email regex pattern
    // Matches: local-part@domain.tld
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    
    return emailRegex.test(email.trim());
}
