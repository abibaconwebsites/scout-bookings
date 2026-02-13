/**
 * Scout Bookings - Public Booking Page Logic
 * 
 * Handles public booking requests without authentication.
 * Shows only unavailable times (no booking details) and submits pending bookings.
 * 
 * @module public-booking
 */

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

/** @type {Object|null} The current hut data */
let currentHut = null;

/** @type {Array} Cached unavailable time slots for the selected date */
let unavailableSlots = [];

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initializes the public booking page.
 * Extracts slug from URL and loads hut data.
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('[PublicBooking] Initializing...');
    
    showLoading(true);
    
    try {
        // Extract slug from URL path
        const slug = getSlugFromUrl();
        
        if (!slug) {
            showError('Invalid URL', 'No booking page specified.');
            return;
        }
        
        console.log('[PublicBooking] Loading hut with slug:', slug);
        
        // Load hut data
        const hut = await loadHutBySlug(slug);
        
        if (!hut) {
            showError('Not Found', 'This booking page does not exist.');
            return;
        }
        
        // Check if public booking is enabled
        if (!hut.public_booking_enabled) {
            showError('Bookings Disabled', 'Public bookings are not currently available for this venue.');
            return;
        }
        
        // Check if hut is active
        if (!hut.is_active) {
            showError('Unavailable', 'This venue is not currently accepting bookings.');
            return;
        }
        
        currentHut = hut;
        
        // Populate page with hut data
        populateHutInfo(hut);
        
        // Set up date constraints
        setupDateConstraints(hut);
        
        // Set up event listeners
        setupEventListeners();
        
        // Show the form
        document.getElementById('hut-hero').style.display = 'block';
        document.getElementById('booking-form').style.display = 'block';
        
    } catch (err) {
        console.error('[PublicBooking] Initialization error:', err);
        showError('Error', 'An unexpected error occurred. Please try again later.');
    } finally {
        showLoading(false);
    }
});

// =============================================================================
// URL HANDLING
// =============================================================================

/**
 * Extracts the slug from the current URL.
 * Expects URL format: /book/slug-name
 * 
 * @returns {string|null} The slug or null if not found
 */
function getSlugFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/book\/([^\/]+)/);
    return match ? match[1] : null;
}

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Loads a hut by its URL slug.
 * 
 * @param {string} slug - The hut's URL slug
 * @returns {Promise<Object|null>} The hut data or null if not found
 */
async function loadHutBySlug(slug) {
    try {
        const { data, error } = await supabaseClient
            .from('scout_huts')
            .select('*')
            .eq('slug', slug)
            .eq('is_active', true)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return null; // Not found
            }
            console.error('[PublicBooking] Error loading hut:', error);
            return null;
        }
        
        return data;
    } catch (err) {
        console.error('[PublicBooking] Unexpected error loading hut:', err);
        return null;
    }
}

/**
 * Gets unavailable time slots for a specific date.
 * Returns only time ranges, not booking details (for privacy).
 * 
 * @param {string} hutId - The hut ID
 * @param {string} date - The date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of { start_time, end_time } objects
 */
async function getUnavailableTimesForDate(hutId, date) {
    try {
        // Calculate date range for the selected date
        const startOfDay = new Date(`${date}T00:00:00`);
        const endOfDay = new Date(`${date}T23:59:59`);
        
        // Fetch confirmed and pending bookings for this date
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('start_time, end_time')
            .eq('hut_id', hutId)
            .in('status', ['confirmed', 'pending'])
            .gte('start_time', startOfDay.toISOString())
            .lte('start_time', endOfDay.toISOString());
        
        if (error) {
            console.error('[PublicBooking] Error fetching bookings:', error);
            return [];
        }
        
        // Get buffer times from hut settings
        const bufferBefore = currentHut?.booking_buffer_before || 0;
        const bufferAfter = currentHut?.booking_buffer_after || 0;
        
        // Convert bookings to unavailable slots with buffer times
        const unavailable = (bookings || []).map(booking => {
            const start = new Date(booking.start_time);
            const end = new Date(booking.end_time);
            
            // Apply buffer times
            start.setMinutes(start.getMinutes() - bufferBefore);
            end.setMinutes(end.getMinutes() + bufferAfter);
            
            return {
                start_time: start.toTimeString().slice(0, 5),
                end_time: end.toTimeString().slice(0, 5)
            };
        });
        
        // Also check for weekly sessions on this day
        const dayOfWeek = startOfDay.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const sessions = currentHut?.weekly_sessions || {};
        
        Object.values(sessions).forEach(session => {
            if (session.enabled && session.day === dayOfWeek) {
                unavailable.push({
                    start_time: session.start_time,
                    end_time: session.end_time
                });
            }
        });
        
        // Sort by start time
        unavailable.sort((a, b) => a.start_time.localeCompare(b.start_time));
        
        return unavailable;
    } catch (err) {
        console.error('[PublicBooking] Error getting unavailable times:', err);
        return [];
    }
}

// =============================================================================
// UI POPULATION
// =============================================================================

/**
 * Populates the page with hut information.
 * 
 * @param {Object} hut - The hut data
 */
function populateHutInfo(hut) {
    // Set page title
    document.title = `Book ${hut.name} - Scout Bookings`;
    
    // Set hut name and location
    document.getElementById('hut-name').textContent = hut.name;
    document.getElementById('hut-city').textContent = hut.city || 'Location';
    
    // Populate availability days
    populateAvailabilityDays(hut.availability);
}

/**
 * Populates the availability days display.
 * 
 * @param {Object} availability - The availability schedule
 */
function populateAvailabilityDays(availability) {
    const container = document.getElementById('availability-days');
    if (!container || !availability) return;
    
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = {
        monday: 'Mon',
        tuesday: 'Tue',
        wednesday: 'Wed',
        thursday: 'Thu',
        friday: 'Fri',
        saturday: 'Sat',
        sunday: 'Sun'
    };
    
    container.innerHTML = '';
    
    days.forEach(day => {
        const config = availability[day];
        const isAvailable = config && config.enabled;
        
        const dayEl = document.createElement('span');
        dayEl.className = `availability-day ${isAvailable ? 'available' : ''}`;
        
        if (isAvailable) {
            dayEl.textContent = `${dayNames[day]} ${config.start_time}-${config.end_time}`;
        } else {
            dayEl.textContent = `${dayNames[day]} Closed`;
            dayEl.style.opacity = '0.5';
        }
        
        container.appendChild(dayEl);
    });
}

/**
 * Sets up date input constraints based on hut settings.
 * 
 * @param {Object} hut - The hut data
 */
function setupDateConstraints(hut) {
    const dateInput = document.getElementById('booking-date');
    const dateHint = document.getElementById('date-hint');
    
    if (!dateInput) return;
    
    // Calculate minimum date based on advance booking days
    const minAdvanceDays = hut.min_booking_advance_days || 1;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + minAdvanceDays);
    
    // Set minimum date
    dateInput.min = minDate.toISOString().split('T')[0];
    
    // Set maximum date (e.g., 6 months ahead)
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 6);
    dateInput.max = maxDate.toISOString().split('T')[0];
    
    // Update hint
    if (minAdvanceDays === 1) {
        dateHint.textContent = 'Bookings must be at least 1 day in advance';
    } else {
        dateHint.textContent = `Bookings must be at least ${minAdvanceDays} days in advance`;
    }
}

/**
 * Updates the unavailable times display for a selected date.
 * 
 * @param {string} date - The selected date in YYYY-MM-DD format
 */
async function updateUnavailableTimes(date) {
    const section = document.getElementById('unavailable-section');
    const list = document.getElementById('unavailable-list');
    const dateDisplay = document.getElementById('unavailable-date-display');
    
    if (!section || !list || !currentHut) return;
    
    // Show section
    section.style.display = 'block';
    
    // Update date display
    const displayDate = new Date(date + 'T12:00:00');
    dateDisplay.textContent = displayDate.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    
    // Check if the selected day is available
    const dayOfWeek = displayDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayAvailability = currentHut.availability?.[dayOfWeek];
    
    if (!dayAvailability || !dayAvailability.enabled) {
        list.innerHTML = `
            <div class="unavailable-slot" style="border-left-color: var(--color-warning);">
                <span class="unavailable-slot-time">All day</span>
                <span>Venue closed on ${dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)}s</span>
            </div>
        `;
        return;
    }
    
    // Fetch unavailable times
    unavailableSlots = await getUnavailableTimesForDate(currentHut.id, date);
    
    if (unavailableSlots.length === 0) {
        list.innerHTML = `
            <div class="no-unavailable">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <span>All times available (${dayAvailability.start_time} - ${dayAvailability.end_time})</span>
            </div>
        `;
    } else {
        list.innerHTML = unavailableSlots.map(slot => `
            <div class="unavailable-slot">
                <span class="unavailable-slot-time">${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</span>
                <span>Unavailable</span>
            </div>
        `).join('');
    }
}

/**
 * Formats a time string to 12-hour format.
 * 
 * @param {string} time - Time in HH:MM format
 * @returns {string} Formatted time (e.g., "9:00am")
 */
function formatTime12h(time) {
    if (!time) return '';
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    return minutes === 0 ? `${hour12}${period}` : `${hour12}:${minutes.toString().padStart(2, '0')}${period}`;
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

/**
 * Sets up event listeners for the booking form.
 */
function setupEventListeners() {
    const form = document.getElementById('booking-form');
    const dateInput = document.getElementById('booking-date');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    
    // Date change - load unavailable times
    dateInput?.addEventListener('change', async (e) => {
        await updateUnavailableTimes(e.target.value);
        checkTimeConflict();
    });
    
    // Time change - check for conflicts
    startTimeInput?.addEventListener('change', checkTimeConflict);
    endTimeInput?.addEventListener('change', checkTimeConflict);
    
    // Form submission
    form?.addEventListener('submit', handleFormSubmit);
}

/**
 * Checks if the selected time conflicts with unavailable slots.
 */
function checkTimeConflict() {
    const startTime = document.getElementById('start-time')?.value;
    const endTime = document.getElementById('end-time')?.value;
    const conflictWarning = document.getElementById('conflict-warning');
    const submitBtn = document.getElementById('submit-btn');
    
    if (!startTime || !endTime || !conflictWarning) return;
    
    // Check against unavailable slots
    const hasConflict = unavailableSlots.some(slot => {
        return timeRangesOverlap(startTime, endTime, slot.start_time, slot.end_time);
    });
    
    // Check against day availability
    const dateInput = document.getElementById('booking-date');
    let dayUnavailable = false;
    
    if (dateInput?.value && currentHut?.availability) {
        const date = new Date(dateInput.value + 'T12:00:00');
        const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const dayConfig = currentHut.availability[dayOfWeek];
        
        if (!dayConfig || !dayConfig.enabled) {
            dayUnavailable = true;
        } else {
            // Check if time is within available hours
            if (startTime < dayConfig.start_time || endTime > dayConfig.end_time) {
                dayUnavailable = true;
            }
        }
    }
    
    if (hasConflict || dayUnavailable) {
        conflictWarning.classList.add('visible');
        submitBtn.disabled = true;
    } else {
        conflictWarning.classList.remove('visible');
        submitBtn.disabled = false;
    }
}

/**
 * Checks if two time ranges overlap.
 * 
 * @param {string} start1 - Start time of first range (HH:MM)
 * @param {string} end1 - End time of first range (HH:MM)
 * @param {string} start2 - Start time of second range (HH:MM)
 * @param {string} end2 - End time of second range (HH:MM)
 * @returns {boolean} True if ranges overlap
 */
function timeRangesOverlap(start1, end1, start2, end2) {
    return start1 < end2 && end1 > start2;
}

// =============================================================================
// FORM SUBMISSION
// =============================================================================

/**
 * Handles the booking form submission.
 * 
 * @param {Event} e - The form submit event
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    
    try {
        // Gather form data
        const formData = {
            hut_id: currentHut.id,
            event_name: document.getElementById('event-name').value.trim(),
            contact_name: document.getElementById('contact-name').value.trim(),
            contact_email: document.getElementById('contact-email').value.trim(),
            contact_phone: document.getElementById('contact-phone').value.trim() || null,
            notes: document.getElementById('notes').value.trim() || null,
            date: document.getElementById('booking-date').value,
            start_time: document.getElementById('start-time').value,
            end_time: document.getElementById('end-time').value
        };
        
        // Validate
        if (!formData.event_name || !formData.contact_name || !formData.contact_email) {
            showNotification('Please fill in all required fields', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request Booking';
            return;
        }
        
        // Submit the booking request
        const result = await submitPublicBooking(formData);
        
        if (result.error) {
            showNotification(result.error.message || 'Failed to submit booking', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request Booking';
            return;
        }
        
        // Show success
        showSuccess(formData);
        
    } catch (err) {
        console.error('[PublicBooking] Submit error:', err);
        showNotification('An unexpected error occurred', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Request Booking';
    }
}

/**
 * Submits a public booking request.
 * Creates a pending booking with a unique token.
 * 
 * @param {Object} formData - The booking form data
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
async function submitPublicBooking(formData) {
    try {
        // Generate booking token
        const bookingToken = generateBookingToken();
        
        // Build start and end timestamps
        const startTime = new Date(`${formData.date}T${formData.start_time}:00`);
        const endTime = new Date(`${formData.date}T${formData.end_time}:00`);
        
        // Validate times
        if (endTime <= startTime) {
            return { data: null, error: { message: 'End time must be after start time' } };
        }
        
        // Insert the booking
        const { data, error } = await supabaseClient
            .from('bookings')
            .insert({
                hut_id: formData.hut_id,
                event_name: formData.event_name,
                contact_name: formData.contact_name,
                contact_email: formData.contact_email,
                contact_phone: formData.contact_phone,
                notes: formData.notes,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                status: 'pending',
                source: 'public',
                booking_token: bookingToken
            })
            .select()
            .single();
        
        if (error) {
            console.error('[PublicBooking] Insert error:', error);
            return { data: null, error };
        }
        
        // Trigger email notification (via Edge Function)
        await sendBookingNotification(data, currentHut);
        
        return { data, error: null };
        
    } catch (err) {
        console.error('[PublicBooking] Unexpected error:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

/**
 * Generates a unique booking token.
 * 
 * @returns {string} A unique token
 */
function generateBookingToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

/**
 * Sends a booking notification email via Edge Function.
 * 
 * @param {Object} booking - The booking data
 * @param {Object} hut - The hut data
 */
async function sendBookingNotification(booking, hut) {
    try {
        // Call the Edge Function
        const { data, error } = await supabaseClient.functions.invoke('send-email', {
            body: {
                type: 'booking_request',
                booking: booking,
                hut: {
                    id: hut.id,
                    name: hut.name,
                    owner_id: hut.owner_id
                }
            }
        });
        
        if (error) {
            console.error('[PublicBooking] Email notification error:', error);
            // Don't fail the booking if email fails
        }
    } catch (err) {
        console.error('[PublicBooking] Email notification error:', err);
        // Don't fail the booking if email fails
    }
}

// =============================================================================
// UI STATE MANAGEMENT
// =============================================================================

/**
 * Shows or hides the loading overlay.
 * 
 * @param {boolean} show - Whether to show the loading overlay
 */
function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.toggle('visible', show);
    }
}

/**
 * Shows the error state.
 * 
 * @param {string} title - The error title
 * @param {string} message - The error message
 */
function showError(title, message) {
    document.getElementById('hut-hero').style.display = 'none';
    document.getElementById('booking-form').style.display = 'none';
    document.getElementById('success-card').style.display = 'none';
    
    const errorCard = document.getElementById('error-card');
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    errorCard.classList.add('visible');
}

/**
 * Shows the success state.
 * 
 * @param {Object} formData - The submitted form data
 */
function showSuccess(formData) {
    document.getElementById('booking-form').style.display = 'none';
    
    // Populate success details
    document.getElementById('success-event').textContent = formData.event_name;
    
    const date = new Date(formData.date + 'T12:00:00');
    document.getElementById('success-date').textContent = date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    
    document.getElementById('success-time').textContent = 
        `${formatTime12h(formData.start_time)} - ${formatTime12h(formData.end_time)}`;
    
    document.getElementById('success-card').classList.add('visible');
}

/**
 * Shows a toast notification.
 * 
 * @param {string} message - The message to display
 * @param {string} type - The notification type (success, error, info)
 */
function showNotification(message, type = 'info') {
    // Use the global showNotification if available, otherwise create simple alert
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        // Simple fallback
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'error' ? '#fee2e2' : type === 'success' ? '#dcfce7' : '#e0e7ff'};
            color: ${type === 'error' ? '#991b1b' : type === 'success' ? '#166534' : '#3730a3'};
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            font-family: inherit;
        `;
        container.textContent = message;
        document.body.appendChild(container);
        
        setTimeout(() => container.remove(), 3000);
    }
}
