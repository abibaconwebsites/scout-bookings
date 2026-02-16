/**
 * Scout Bookings bookings: create and manage booking records.
 * Bookings are tied to scout huts owned by users.
 */

// =============================================================================
// SESSION REFRESH HELPER
// =============================================================================

/**
 * Ensures the user's session is valid and refreshes it if needed.
 * Call this before any database write operation to prevent RLS errors
 * from expired tokens.
 * 
 * @returns {Promise<boolean>} True if session is valid, false otherwise
 */
async function ensureValidSession() {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        
        if (error || !session) {
            console.warn('No valid session found');
            return false;
        }
        
        // Check if session is close to expiring (within 5 minutes)
        if (session.expires_at) {
            const expiresAt = session.expires_at * 1000;
            const now = Date.now();
            const fiveMinutes = 5 * 60 * 1000;
            
            if (expiresAt - now < fiveMinutes) {
                console.log('Session expiring soon, refreshing before operation...');
                const { error: refreshError } = await supabaseClient.auth.refreshSession();
                
                if (refreshError) {
                    console.error('Failed to refresh session:', refreshError);
                    return false;
                }
                console.log('Session refreshed successfully');
            }
        }
        
        return true;
    } catch (err) {
        console.error('Error checking session:', err);
        return false;
    }
}

// =============================================================================
// GET BOOKINGS FOR USER'S HUT
// =============================================================================

/**
 * Gets all bookings for the user's hut.
 * 
 * @param {string} hutId - The hut's ID
 * @param {Object} options - Query options
 * @param {boolean} options.upcoming - If true, only return future bookings
 * @param {number} options.limit - Maximum number of bookings to return
 * @returns {Promise<Array>} Array of booking objects
 */
async function getHutBookings(hutId, options = {}) {
    try {
        if (!hutId) {
            return [];
        }

        let query = supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .order('start_time', { ascending: true });

        // Filter to upcoming bookings only
        if (options.upcoming) {
            query = query.gte('start_time', new Date().toISOString());
        }

        // Limit results
        if (options.limit) {
            query = query.limit(options.limit);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching bookings:', error);
            return [];
        }

        return data || [];

    } catch (err) {
        console.error('Unexpected error fetching bookings:', err);
        return [];
    }
}

/**
 * Gets upcoming bookings for the user's hut for the current month only.
 * 
 * @param {string} hutId - The hut's ID
 * @param {number} limit - Maximum number of bookings to return (default 10)
 * @returns {Promise<Array>} Array of upcoming booking objects for this month
 */
async function getUpcomingBookings(hutId, limit = 10) {
    try {
        if (!hutId) {
            return [];
        }

        // Get current date and end of current month
        const now = new Date();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const { data, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .eq('status', 'confirmed')
            .gte('start_time', now.toISOString())
            .lte('start_time', endOfMonth.toISOString())
            .order('start_time', { ascending: true })
            .limit(limit);

        if (error) {
            console.error('Error fetching upcoming bookings:', error);
            return [];
        }

        return data || [];

    } catch (err) {
        console.error('Unexpected error fetching upcoming bookings:', err);
        return [];
    }
}

/**
 * Gets bookings for the current month.
 * 
 * @param {string} hutId - The hut's ID
 * @returns {Promise<Array>} Array of booking objects for this month
 */
async function getMonthBookings(hutId) {
    try {
        if (!hutId) {
            return [];
        }

        // Get first and last day of current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const { data, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .gte('start_time', firstDay.toISOString())
            .lte('start_time', lastDay.toISOString())
            .order('start_time', { ascending: true });

        if (error) {
            console.error('Error fetching month bookings:', error);
            return [];
        }

        return data || [];

    } catch (err) {
        console.error('Unexpected error fetching month bookings:', err);
        return [];
    }
}

// =============================================================================
// CREATE BOOKING
// =============================================================================

/**
 * Creates a new booking for a hut.
 * After successful creation, automatically syncs the booking to Google Calendar
 * if the hut has sync enabled with 'both' or 'to_google' direction.
 * 
 * @param {Object} bookingData - The booking data
 * @param {string} bookingData.hut_id - The hut's ID
 * @param {string} bookingData.event_name - Name of the event
 * @param {string} bookingData.contact_name - Contact person's name
 * @param {string} bookingData.contact_email - Contact email
 * @param {string} bookingData.contact_phone - Contact phone (optional)
 * @param {string} bookingData.start_time - Start time (ISO string)
 * @param {string} bookingData.end_time - End time (ISO string)
 * @param {string} bookingData.notes - Additional notes (optional)
 * @returns {Promise<{data: Object|null, error: Object|null, syncStatus?: string}>}
 */
async function createBooking(bookingData) {
    try {
        // Validate required fields
        if (!bookingData.hut_id) {
            return { data: null, error: { message: 'Hut ID is required' } };
        }
        if (!bookingData.event_name || bookingData.event_name.trim() === '') {
            return { data: null, error: { message: 'Event name is required' } };
        }
        if (!bookingData.start_time || !bookingData.end_time) {
            return { data: null, error: { message: 'Start and end times are required' } };
        }

        // Validate time range
        const start = new Date(bookingData.start_time);
        const end = new Date(bookingData.end_time);
        if (end <= start) {
            return { data: null, error: { message: 'End time must be after start time' } };
        }

        // =========================================================================
        // STEP 0: Ensure session is valid (prevents RLS errors from expired tokens)
        // =========================================================================
        const sessionValid = await ensureValidSession();
        if (!sessionValid) {
            return { data: null, error: { message: 'Your session has expired. Please refresh the page and try again.' } };
        }

        // =========================================================================
        // STEP 1: Create booking in database
        // =========================================================================
        const { data, error } = await supabaseClient
            .from('bookings')
            .insert({
                hut_id: bookingData.hut_id,
                event_name: bookingData.event_name.trim(),
                contact_name: bookingData.contact_name?.trim() || null,
                contact_email: bookingData.contact_email?.trim() || null,
                contact_phone: bookingData.contact_phone?.trim() || null,
                start_time: bookingData.start_time,
                end_time: bookingData.end_time,
                notes: bookingData.notes?.trim() || null,
                status: 'confirmed'
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating booking:', error);
            return { data: null, error };
        }

        // =========================================================================
        // STEP 2: Attempt Google Calendar sync (non-blocking)
        // Sync errors should NOT prevent booking creation from succeeding
        // =========================================================================
        let syncStatus = 'not_attempted';
        
        try {
            // Get hut sync settings to determine if we should sync to Google
            const { data: hutData, error: hutError } = await supabaseClient
                .from('scout_huts')
                .select('sync_enabled, sync_direction, google_calendar_id, owner_id')
                .eq('id', bookingData.hut_id)
                .single();

            if (hutError) {
                console.error('[Booking] Error fetching hut sync settings:', hutError);
                syncStatus = 'error_fetching_settings';
            } else if (hutData) {
                // Check if sync should happen:
                // - sync_enabled must be true
                // - sync_direction must be 'both' or 'to_google'
                // - google_calendar_id must be set
                const shouldSync = hutData.sync_enabled && 
                    ['both', 'to_google'].includes(hutData.sync_direction) &&
                    hutData.google_calendar_id;

                if (shouldSync) {
                    console.log('[Booking] Hut has sync enabled, syncing to Google Calendar...');
                    
                    // Get owner's calendar tokens (uses getCalendarTokens from calendar.js)
                    const accessToken = await getCalendarTokens(hutData.owner_id);
                    
                    if (!accessToken) {
                        console.warn('[Booking] No valid calendar tokens for hut owner');
                        syncStatus = 'no_tokens';
                    } else {
                        // Build event description with contact details
                        const description = buildGoogleEventDescription(data);
                        
                        // Create event in Google Calendar
                        const createResult = await createGoogleCalendarEvent(
                            accessToken,
                            hutData.google_calendar_id,
                            {
                                summary: data.event_name,
                                description: description,
                                startTime: data.start_time,
                                endTime: data.end_time
                            }
                        );

                        if (createResult.success && createResult.event) {
                            console.log('[Booking] Successfully synced to Google Calendar:', createResult.event.id);
                            
                            // Insert record into synced_events table for tracking
                            const { error: syncedError } = await supabaseClient
                                .from('synced_events')
                                .insert({
                                    hut_id: bookingData.hut_id,
                                    google_event_id: createResult.event.id,
                                    booking_id: data.id,
                                    event_type: 'scout_to_google',
                                    start_time: data.start_time,
                                    end_time: data.end_time,
                                    title: data.event_name
                                });

                            if (syncedError) {
                                console.error('[Booking] Error recording synced event:', syncedError);
                                // Event was created in Google, just failed to record locally
                                syncStatus = 'synced_not_recorded';
                            } else {
                                console.log('[Booking] Booking synced to Google Calendar successfully');
                                syncStatus = 'synced';
                            }
                        } else {
                            console.error('[Booking] Failed to create Google Calendar event:', createResult.error);
                            syncStatus = 'sync_failed';
                        }
                    }
                } else {
                    // Sync not enabled or not configured for this direction
                    console.log('[Booking] Sync not enabled or not configured for to_google direction');
                    syncStatus = 'sync_disabled';
                }
            }
        } catch (syncErr) {
            // Catch any unexpected errors during sync - booking still succeeds
            console.error('[Booking] Unexpected error during Google Calendar sync:', syncErr);
            syncStatus = 'sync_error';
        }

        // Return booking data with sync status
        // Caller can check syncStatus to show appropriate notification
        return { data, error: null, syncStatus };

    } catch (err) {
        console.error('Unexpected error creating booking:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

/**
 * Builds a description string for Google Calendar events with booking contact details.
 * 
 * @param {Object} booking - The booking object
 * @returns {string} Formatted description for Google Calendar
 */
function buildGoogleEventDescription(booking) {
    const lines = [];
    
    if (booking.contact_name) {
        lines.push(`Booking by: ${booking.contact_name}`);
    }
    if (booking.contact_email) {
        lines.push(`Email: ${booking.contact_email}`);
    }
    if (booking.contact_phone) {
        lines.push(`Phone: ${booking.contact_phone}`);
    }
    if (booking.notes) {
        lines.push(`Notes: ${booking.notes}`);
    }
    
    return lines.join('\n');
}

// =============================================================================
// UPDATE BOOKING
// =============================================================================

/**
 * Updates an existing booking.
 * After successful update, syncs changes to Google Calendar if:
 * - The booking was previously synced (exists in synced_events)
 * - OR the hut has sync enabled with 'both' or 'to_google' direction
 * 
 * @param {string} bookingId - The booking's ID
 * @param {Object} updates - The fields to update
 * @returns {Promise<{data: Object|null, error: Object|null, syncStatus?: string}>}
 */
async function updateBooking(bookingId, updates) {
    try {
        if (!bookingId) {
            return { data: null, error: { message: 'Booking ID is required' } };
        }

        // Ensure session is valid before update
        const sessionValid = await ensureValidSession();
        if (!sessionValid) {
            return { data: null, error: { message: 'Your session has expired. Please refresh the page and try again.' } };
        }

        const updateData = {};
        
        if (updates.event_name !== undefined) {
            updateData.event_name = updates.event_name.trim();
        }
        if (updates.contact_name !== undefined) {
            updateData.contact_name = updates.contact_name?.trim() || null;
        }
        if (updates.contact_email !== undefined) {
            updateData.contact_email = updates.contact_email?.trim() || null;
        }
        if (updates.contact_phone !== undefined) {
            updateData.contact_phone = updates.contact_phone?.trim() || null;
        }
        if (updates.start_time !== undefined) {
            updateData.start_time = updates.start_time;
        }
        if (updates.end_time !== undefined) {
            updateData.end_time = updates.end_time;
        }
        if (updates.notes !== undefined) {
            updateData.notes = updates.notes?.trim() || null;
        }
        if (updates.status !== undefined) {
            updateData.status = updates.status;
        }

        // =========================================================================
        // STEP 1: Update booking in database
        // =========================================================================
        const { data, error } = await supabaseClient
            .from('bookings')
            .update(updateData)
            .eq('id', bookingId)
            .select()
            .single();

        if (error) {
            console.error('Error updating booking:', error);
            return { data: null, error };
        }

        // =========================================================================
        // STEP 2: Attempt Google Calendar sync (non-blocking)
        // Sync errors should NOT prevent booking update from succeeding
        // =========================================================================
        let syncStatus = 'not_attempted';
        
        try {
            // Get hut sync settings to determine if we should sync to Google
            const { data: hutData, error: hutError } = await supabaseClient
                .from('scout_huts')
                .select('sync_enabled, sync_direction, google_calendar_id, owner_id')
                .eq('id', data.hut_id)
                .single();

            if (hutError) {
                console.error('[Booking] Error fetching hut sync settings:', hutError);
                syncStatus = 'error_fetching_settings';
            } else if (hutData) {
                // Check if sync should happen:
                // - sync_enabled must be true
                // - sync_direction must be 'both' or 'to_google'
                // - google_calendar_id must be set
                const shouldSync = hutData.sync_enabled && 
                    ['both', 'to_google'].includes(hutData.sync_direction) &&
                    hutData.google_calendar_id;

                if (shouldSync) {
                    console.log('[Booking] Hut has sync enabled, checking for existing sync record...');
                    
                    // Check if this booking is already synced to Google
                    const { data: syncRecord, error: syncError } = await supabaseClient
                        .from('synced_events')
                        .select('id, google_event_id')
                        .eq('booking_id', bookingId)
                        .eq('event_type', 'scout_to_google')
                        .single();

                    // Get owner's calendar tokens
                    const accessToken = await getCalendarTokens(hutData.owner_id);
                    
                    if (!accessToken) {
                        console.warn('[Booking] No valid calendar tokens for hut owner');
                        syncStatus = 'no_tokens';
                    } else if (syncRecord && syncRecord.google_event_id) {
                        // =========================================================
                        // CASE A: Booking is already synced - UPDATE existing event
                        // =========================================================
                        console.log('[Booking] Found existing sync record, updating Google Calendar event...');
                        
                        // Build event description with contact details
                        const description = buildGoogleEventDescription(data);
                        
                        // Update event in Google Calendar
                        const updateResult = await updateGoogleCalendarEvent(
                            accessToken,
                            hutData.google_calendar_id,
                            syncRecord.google_event_id,
                            {
                                summary: data.event_name,
                                description: description,
                                startTime: data.start_time,
                                endTime: data.end_time
                            }
                        );

                        if (updateResult.success) {
                            console.log('[Booking] Updated event in Google Calendar successfully');
                            
                            // Update synced_events.last_synced_at
                            const { error: updateSyncError } = await supabaseClient
                                .from('synced_events')
                                .update({
                                    last_synced_at: new Date().toISOString(),
                                    title: data.event_name,
                                    start_time: data.start_time,
                                    end_time: data.end_time
                                })
                                .eq('id', syncRecord.id);

                            if (updateSyncError) {
                                console.error('[Booking] Error updating sync record:', updateSyncError);
                                syncStatus = 'synced_not_recorded';
                            } else {
                                syncStatus = 'synced';
                            }
                        } else {
                            console.error('[Booking] Failed to update Google Calendar event:', updateResult.error);
                            
                            // If event not found in Google (404), it may have been deleted
                            // Flag for retry or create new event on next auto-sync
                            if (updateResult.error === 'Event not found') {
                                console.log('[Booking] Event was deleted from Google, will create on next sync');
                                syncStatus = 'event_deleted_in_google';
                            } else {
                                syncStatus = 'sync_failed';
                            }
                        }
                    } else {
                        // =========================================================
                        // CASE B: Booking not synced yet - CREATE new event
                        // =========================================================
                        console.log('[Booking] No existing sync record, creating new Google Calendar event...');
                        
                        // Build event description with contact details
                        const description = buildGoogleEventDescription(data);
                        
                        // Create event in Google Calendar
                        const createResult = await createGoogleCalendarEvent(
                            accessToken,
                            hutData.google_calendar_id,
                            {
                                summary: data.event_name,
                                description: description,
                                startTime: data.start_time,
                                endTime: data.end_time
                            }
                        );

                        if (createResult.success && createResult.event) {
                            console.log('[Booking] Successfully created event in Google Calendar:', createResult.event.id);
                            
                            // Insert record into synced_events table for tracking
                            const { error: syncedError } = await supabaseClient
                                .from('synced_events')
                                .insert({
                                    hut_id: data.hut_id,
                                    google_event_id: createResult.event.id,
                                    booking_id: bookingId,
                                    event_type: 'scout_to_google',
                                    start_time: data.start_time,
                                    end_time: data.end_time,
                                    title: data.event_name
                                });

                            if (syncedError) {
                                console.error('[Booking] Error recording synced event:', syncedError);
                                syncStatus = 'synced_not_recorded';
                            } else {
                                console.log('[Booking] Booking synced to Google Calendar successfully');
                                syncStatus = 'synced';
                            }
                        } else {
                            console.error('[Booking] Failed to create Google Calendar event:', createResult.error);
                            syncStatus = 'sync_failed';
                        }
                    }
                } else {
                    // Sync not enabled or not configured for this direction
                    console.log('[Booking] Sync not enabled or not configured for to_google direction');
                    syncStatus = 'sync_disabled';
                }
            }
        } catch (syncErr) {
            // Catch any unexpected errors during sync - booking update still succeeds
            console.error('[Booking] Unexpected error during Google Calendar sync:', syncErr);
            syncStatus = 'sync_error';
        }

        // Return booking data with sync status
        // Caller can check syncStatus to show appropriate notification
        return { data, error: null, syncStatus };

    } catch (err) {
        console.error('Unexpected error updating booking:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

// =============================================================================
// DELETE BOOKING
// =============================================================================

/**
 * Deletes a booking.
 * Also deletes the corresponding event from Google Calendar if synced.
 * 
 * @param {string} bookingId - The booking's ID
 * @returns {Promise<{success: boolean, error: Object|null, syncStatus?: string}>}
 */
async function deleteBooking(bookingId) {
    try {
        if (!bookingId) {
            return { success: false, error: { message: 'Booking ID is required' } };
        }

        // Ensure session is valid before delete
        const sessionValid = await ensureValidSession();
        if (!sessionValid) {
            return { success: false, error: { message: 'Your session has expired. Please refresh the page and try again.' } };
        }

        // =========================================================================
        // STEP 1: Get booking details before deletion (needed for sync)
        // =========================================================================
        const { data: booking, error: fetchError } = await supabaseClient
            .from('bookings')
            .select('hut_id')
            .eq('id', bookingId)
            .single();

        if (fetchError) {
            console.error('Error fetching booking for deletion:', fetchError);
            // Continue with deletion even if we can't fetch details
        }

        // =========================================================================
        // STEP 2: Delete booking from database
        // =========================================================================
        const { error } = await supabaseClient
            .from('bookings')
            .delete()
            .eq('id', bookingId);

        if (error) {
            console.error('Error deleting booking:', error);
            return { success: false, error };
        }

        // =========================================================================
        // STEP 3: Attempt to delete from Google Calendar (non-blocking)
        // Sync errors should NOT prevent booking deletion from succeeding
        // =========================================================================
        let syncStatus = 'not_attempted';

        try {
            // Check if this booking was synced to Google
            const { data: syncRecord, error: syncQueryError } = await supabaseClient
                .from('synced_events')
                .select('id, google_event_id, hut_id')
                .eq('booking_id', bookingId)
                .eq('event_type', 'scout_to_google')
                .single();

            if (syncQueryError && syncQueryError.code !== 'PGRST116') {
                // PGRST116 = no rows returned (not synced), which is fine
                console.error('[Booking] Error checking sync record:', syncQueryError);
                syncStatus = 'error_checking_sync';
            } else if (syncRecord && syncRecord.google_event_id) {
                console.log('[Booking] Found sync record, deleting from Google Calendar...');

                // Get hut sync settings for calendar ID and owner
                const hutId = syncRecord.hut_id || booking?.hut_id;
                
                if (hutId) {
                    const { data: hutData, error: hutError } = await supabaseClient
                        .from('scout_huts')
                        .select('google_calendar_id, owner_id')
                        .eq('id', hutId)
                        .single();

                    if (hutError) {
                        console.error('[Booking] Error fetching hut settings:', hutError);
                        syncStatus = 'error_fetching_settings';
                    } else if (hutData && hutData.google_calendar_id) {
                        // Get owner's calendar tokens
                        const accessToken = await getCalendarTokens(hutData.owner_id);

                        if (!accessToken) {
                            console.warn('[Booking] No valid calendar tokens for hut owner');
                            syncStatus = 'no_tokens';
                        } else {
                            // Delete event from Google Calendar
                            const deleteResult = await deleteGoogleCalendarEvent(
                                accessToken,
                                hutData.google_calendar_id,
                                syncRecord.google_event_id
                            );

                            if (deleteResult.success) {
                                console.log('[Booking] Deleted event from Google Calendar successfully');

                                // Delete record from synced_events
                                const { error: deleteSyncError } = await supabaseClient
                                    .from('synced_events')
                                    .delete()
                                    .eq('id', syncRecord.id);

                                if (deleteSyncError) {
                                    console.error('[Booking] Error deleting sync record:', deleteSyncError);
                                    // Event deleted from Google, just failed to clean up local record
                                    syncStatus = 'synced_not_cleaned';
                                } else {
                                    syncStatus = 'synced';
                                }
                            } else {
                                console.error('[Booking] Failed to delete from Google Calendar:', deleteResult.error);
                                // Leave synced_events record - will be cleaned up on next sync
                                syncStatus = 'sync_failed';
                            }
                        }
                    } else {
                        console.log('[Booking] No Google Calendar configured for hut');
                        syncStatus = 'no_calendar';
                    }
                } else {
                    console.warn('[Booking] Could not determine hut ID for sync deletion');
                    syncStatus = 'no_hut_id';
                }
            } else {
                // Booking was not synced to Google
                console.log('[Booking] Booking was not synced to Google Calendar');
                syncStatus = 'not_synced';
            }
        } catch (syncErr) {
            // Catch any unexpected errors during sync - booking deletion still succeeds
            console.error('[Booking] Unexpected error during Google Calendar sync deletion:', syncErr);
            syncStatus = 'sync_error';
        }

        return { success: true, error: null, syncStatus };

    } catch (err) {
        console.error('Unexpected error deleting booking:', err);
        return { success: false, error: { message: 'An unexpected error occurred' } };
    }
}

/**
 * Cancels a booking (sets status to 'cancelled').
 * Also deletes the corresponding event from Google Calendar if synced.
 * 
 * @param {string} bookingId - The booking's ID
 * @returns {Promise<{data: Object|null, error: Object|null, syncStatus?: string}>}
 */
async function cancelBooking(bookingId) {
    try {
        if (!bookingId) {
            return { data: null, error: { message: 'Booking ID is required' } };
        }

        // =========================================================================
        // STEP 1: Update booking status to cancelled
        // =========================================================================
        const { data, error } = await supabaseClient
            .from('bookings')
            .update({ status: 'cancelled' })
            .eq('id', bookingId)
            .select()
            .single();

        if (error) {
            console.error('Error cancelling booking:', error);
            return { data: null, error };
        }

        // =========================================================================
        // STEP 2: Delete from Google Calendar (cancelled bookings shouldn't show)
        // =========================================================================
        let syncStatus = 'not_attempted';

        try {
            // Check if this booking was synced to Google
            const { data: syncRecord, error: syncQueryError } = await supabaseClient
                .from('synced_events')
                .select('id, google_event_id')
                .eq('booking_id', bookingId)
                .eq('event_type', 'scout_to_google')
                .single();

            if (syncQueryError && syncQueryError.code !== 'PGRST116') {
                console.error('[Booking] Error checking sync record:', syncQueryError);
                syncStatus = 'error_checking_sync';
            } else if (syncRecord && syncRecord.google_event_id) {
                console.log('[Booking] Found sync record, deleting cancelled booking from Google Calendar...');

                // Get hut sync settings
                const { data: hutData, error: hutError } = await supabaseClient
                    .from('scout_huts')
                    .select('google_calendar_id, owner_id')
                    .eq('id', data.hut_id)
                    .single();

                if (hutError) {
                    console.error('[Booking] Error fetching hut settings:', hutError);
                    syncStatus = 'error_fetching_settings';
                } else if (hutData && hutData.google_calendar_id) {
                    // Get owner's calendar tokens
                    const accessToken = await getCalendarTokens(hutData.owner_id);

                    if (!accessToken) {
                        console.warn('[Booking] No valid calendar tokens for hut owner');
                        syncStatus = 'no_tokens';
                    } else {
                        // Delete event from Google Calendar
                        const deleteResult = await deleteGoogleCalendarEvent(
                            accessToken,
                            hutData.google_calendar_id,
                            syncRecord.google_event_id
                        );

                        if (deleteResult.success) {
                            console.log('[Booking] Deleted cancelled event from Google Calendar successfully');

                            // Delete record from synced_events
                            const { error: deleteSyncError } = await supabaseClient
                                .from('synced_events')
                                .delete()
                                .eq('id', syncRecord.id);

                            if (deleteSyncError) {
                                console.error('[Booking] Error deleting sync record:', deleteSyncError);
                                syncStatus = 'synced_not_cleaned';
                            } else {
                                syncStatus = 'synced';
                            }
                        } else {
                            console.error('[Booking] Failed to delete from Google Calendar:', deleteResult.error);
                            syncStatus = 'sync_failed';
                        }
                    }
                }
            } else {
                console.log('[Booking] Cancelled booking was not synced to Google Calendar');
                syncStatus = 'not_synced';
            }
        } catch (syncErr) {
            console.error('[Booking] Unexpected error during Google Calendar sync deletion:', syncErr);
            syncStatus = 'sync_error';
        }

        return { data, error: null, syncStatus };

    } catch (err) {
        console.error('Unexpected error cancelling booking:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

// =============================================================================
// FORMAT BOOKING FOR DISPLAY
// =============================================================================

// =============================================================================
// CHECK FOR BOOKING CONFLICTS
// =============================================================================

/**
 * Checks if a proposed booking time conflicts with existing bookings, weekly sessions,
 * or synced Google Calendar events.
 * 
 * AVAILABILITY CHECK LOGIC:
 * This function checks THREE sources for conflicts:
 * 
 * 1. BOOKINGS TABLE - Existing confirmed bookings made through Scout Bookings
 *    - Only checks bookings with status = 'confirmed'
 *    - Excludes the booking being edited (if excludeBookingId provided)
 * 
 * 2. WEEKLY SESSIONS - Recurring scout group sessions (Squirrels, Beavers, Cubs, Scouts)
 *    - Configured per-hut in hut.weekly_sessions
 *    - Blocks time every week on the configured day
 * 
 * 3. SYNCED GOOGLE CALENDAR EVENTS - Events imported from the owner's Google Calendar
 *    - Only checks events with event_type = 'google_to_scout'
 *    - These represent times when the hut owner has personal commitments
 *    - Private event details are NOT exposed to public users for privacy
 * 
 * @param {string} hutId - The hut's ID
 * @param {Object} hut - The hut object (with weekly_sessions)
 * @param {string} date - The date in YYYY-MM-DD format
 * @param {string} startTime - Start time in HH:MM format
 * @param {string} endTime - End time in HH:MM format
 * @param {string|null} excludeBookingId - Booking ID to exclude (for updates)
 * @returns {Promise<{hasConflict: boolean, conflicts: Array}>}
 */
async function checkBookingConflicts(hutId, hut, date, startTime, endTime, excludeBookingId = null) {
    const conflicts = [];
    
    // Convert times to comparable format
    const proposedStart = `${date}T${startTime}`;
    const proposedEnd = `${date}T${endTime}`;
    const propStartDate = new Date(proposedStart);
    const propEndDate = new Date(proposedEnd);
    
    // =========================================================================
    // CHECK 1: Existing bookings in the bookings table
    // Query confirmed AND pending bookings that overlap with the requested time
    // =========================================================================
    try {
        const dayStart = new Date(`${date}T00:00:00`).toISOString();
        const dayEnd = new Date(`${date}T23:59:59`).toISOString();
        
        let query = supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .in('status', ['confirmed', 'pending'])  // Check both confirmed and pending
            .gte('start_time', dayStart)
            .lte('start_time', dayEnd);
        
        if (excludeBookingId) {
            query = query.neq('id', excludeBookingId);
        }
        
        const { data: bookings, error } = await query;
        
        if (!error && bookings) {
            for (const booking of bookings) {
                const bookingStart = new Date(booking.start_time);
                const bookingEnd = new Date(booking.end_time);
                
                // Check for overlap: starts before other ends AND ends after other starts
                if (propStartDate < bookingEnd && propEndDate > bookingStart) {
                    const startStr = bookingStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    const endStr = bookingEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    conflicts.push({
                        type: 'booking',
                        name: booking.event_name,
                        time: `${startStr} - ${endStr}`,
                        contact: booking.contact_name || null
                    });
                }
            }
        }
    } catch (err) {
        console.error('Error checking booking conflicts:', err);
    }
    
    // =========================================================================
    // CHECK 2: Synced Google Calendar events (imported from owner's calendar)
    // These are events with event_type = 'google_to_scout' that block time
    // PRIVACY: We don't expose the actual event title to public users
    // =========================================================================
    try {
        const dayStart = new Date(`${date}T00:00:00`).toISOString();
        const dayEnd = new Date(`${date}T23:59:59`).toISOString();
        
        // Query synced_events for Google Calendar events imported to Scout
        // Overlap condition: event starts before requested end AND ends after requested start
        const { data: syncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('id, start_time, end_time, title')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout')  // Only events imported FROM Google
            .lte('start_time', propEndDate.toISOString())  // Event starts before requested end
            .gte('end_time', propStartDate.toISOString()); // Event ends after requested start
        
        if (!syncedError && syncedEvents) {
            for (const event of syncedEvents) {
                const eventStart = new Date(event.start_time);
                const eventEnd = new Date(event.end_time);
                
                // Double-check overlap (belt and suspenders with the query)
                if (propStartDate < eventEnd && propEndDate > eventStart) {
                    const startStr = eventStart.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    const endStr = eventEnd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    
                    // PRIVACY: Don't expose actual Google event title to public users
                    // Just indicate the time is blocked due to owner's commitment
                    conflicts.push({
                        type: 'google-event',
                        name: 'Owner unavailable',  // Generic message for privacy
                        time: `${startStr} - ${endStr}`,
                        // Store actual title internally (for owner's view only)
                        _internalTitle: event.title
                    });
                }
            }
        }
    } catch (err) {
        console.error('Error checking synced Google Calendar events:', err);
    }
    
    // =========================================================================
    // CHECK 3: Weekly sessions for that day (recurring scout group meetings)
    // =========================================================================
    if (hut && hut.weekly_sessions) {
        const dateObj = new Date(date);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dateObj.getDay()];
        
        const groupDisplayNames = {
            squirrels: 'Squirrels',
            beavers: 'Beavers',
            cubs: 'Cubs',
            scouts: 'Scouts'
        };
        
        for (const [group, config] of Object.entries(hut.weekly_sessions)) {
            if (config.enabled && config.day === dayName) {
                const sessionStart = new Date(`${date}T${config.start_time}`);
                const sessionEnd = new Date(`${date}T${config.end_time}`);
                
                // Check for overlap
                if (propStartDate < sessionEnd && propEndDate > sessionStart) {
                    conflicts.push({
                        type: 'session',
                        name: groupDisplayNames[group],
                        time: `${config.start_time} - ${config.end_time}`
                    });
                }
            }
        }
    }
    
    return {
        hasConflict: conflicts.length > 0,
        conflicts
    };
}

/**
 * Gets all blocked time slots for a specific date.
 * 
 * BLOCKED TIME SOURCES:
 * 1. Bookings - Events booked through Scout Bookings
 * 2. Weekly sessions - Recurring scout group meetings
 * 3. Synced Google Calendar events - Owner's personal commitments imported from Google
 * 
 * @param {string} hutId - The hut's ID
 * @param {Object} hut - The hut object (with weekly_sessions)
 * @param {string} date - The date in YYYY-MM-DD format
 * @param {boolean} isOwner - If true, show actual Google event titles (for owner's view)
 * @returns {Promise<Array>} Array of blocked time slots
 */
async function getBlockedTimeSlotsForDate(hutId, hut, date, isOwner = false, excludeBookingId = null) {
    const blockedSlots = [];
    
    // =========================================================================
    // SOURCE 1: Get existing bookings for that day
    // =========================================================================
    try {
        const dayStart = new Date(`${date}T00:00:00`).toISOString();
        const dayEnd = new Date(`${date}T23:59:59`).toISOString();
        
        const { data: bookings, error } = await supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .in('status', ['confirmed', 'pending'])
            .gte('start_time', dayStart)
            .lte('start_time', dayEnd)
            .order('start_time', { ascending: true });
        
        if (!error && bookings) {
            for (const booking of bookings) {
                // Skip the booking being edited
                if (excludeBookingId && booking.id === excludeBookingId) {
                    continue;
                }
                const start = new Date(booking.start_time);
                const end = new Date(booking.end_time);
                const isPending = booking.status === 'pending';
                blockedSlots.push({
                    type: 'booking',
                    name: booking.event_name + (isPending ? ' (Pending)' : ''),
                    start_time: start.toTimeString().slice(0, 5),
                    end_time: end.toTimeString().slice(0, 5),
                    color: isPending ? '#9ca3af' : 'var(--color-primary)',
                    status: booking.status
                });
            }
        }
    } catch (err) {
        console.error('Error fetching bookings:', err);
    }
    
    // =========================================================================
    // SOURCE 2: Get synced Google Calendar events for that day
    // These are events imported from the owner's Google Calendar (google_to_scout)
    // =========================================================================
    try {
        const dayStart = new Date(`${date}T00:00:00`).toISOString();
        const dayEnd = new Date(`${date}T23:59:59`).toISOString();
        
        const { data: syncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('id, start_time, end_time, title')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout')
            .gte('start_time', dayStart)
            .lte('start_time', dayEnd)
            .order('start_time', { ascending: true });
        
        if (!syncedError && syncedEvents) {
            for (const event of syncedEvents) {
                const start = new Date(event.start_time);
                const end = new Date(event.end_time);
                
                // PRIVACY: Only show actual event title to the hut owner
                // Public users see a generic "Owner unavailable" message
                const displayName = isOwner && event.title 
                    ? event.title 
                    : 'Owner unavailable';
                
                blockedSlots.push({
                    type: 'google-event',
                    name: displayName,
                    start_time: start.toTimeString().slice(0, 5),
                    end_time: end.toTimeString().slice(0, 5),
                    color: '#9b59b6',  // Purple to distinguish from bookings/sessions
                    isGoogleEvent: true
                });
            }
        }
    } catch (err) {
        console.error('Error fetching synced Google Calendar events:', err);
    }
    
    // =========================================================================
    // SOURCE 3: Get weekly sessions for that day
    // =========================================================================
    if (hut && hut.weekly_sessions) {
        const dateObj = new Date(date);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dateObj.getDay()];
        
        const defaultGroupColors = {
            squirrels: '#e74c3c',
            beavers: '#3498db',
            cubs: '#f39c12',
            scouts: '#27ae60'
        };
        
        const groupNames = {
            squirrels: 'Squirrels',
            beavers: 'Beavers',
            cubs: 'Cubs',
            scouts: 'Scouts'
        };
        
        for (const [group, config] of Object.entries(hut.weekly_sessions)) {
            if (config.enabled && config.day === dayName) {
                blockedSlots.push({
                    type: 'session',
                    name: `${groupNames[group]} session`,
                    start_time: config.start_time,
                    end_time: config.end_time,
                    color: config.color || defaultGroupColors[group],
                    group: group
                });
            }
        }
    }
    
    // Sort by start time
    blockedSlots.sort((a, b) => a.start_time.localeCompare(b.start_time));
    
    return blockedSlots;
}

// =============================================================================
// CHECK AVAILABILITY (PUBLIC API)
// =============================================================================

/**
 * Checks if a requested time slot is available for booking.
 * 
 * This is the main availability check function that should be called before
 * creating a booking. It checks all sources of conflicts and returns a
 * structured response suitable for displaying to users.
 * 
 * CONFLICT SOURCES CHECKED:
 * 1. bookings table - Existing confirmed bookings
 * 2. synced_events table - Google Calendar events imported from owner's calendar
 *    (event_type = 'google_to_scout')
 * 3. weekly_sessions - Recurring scout group meetings (if hut object provided)
 * 
 * PRIVACY CONSIDERATIONS:
 * - For 'google-event' conflicts, we don't expose the actual event title
 * - Public users see "Owner has personal commitment" message
 * - The actual title is stored in _internalTitle for owner's use only
 * 
 * @param {string} hutId - The hut's ID
 * @param {string} requestedStart - Start time as ISO string or Date
 * @param {string} requestedEnd - End time as ISO string or Date
 * @param {Object} options - Optional parameters
 * @param {string} options.excludeBookingId - Booking ID to exclude (for updates)
 * @param {Object} options.hut - Hut object with weekly_sessions (for session checks)
 * @returns {Promise<{available: boolean, conflicts: Array}>}
 * 
 * @example
 * const result = await checkAvailability(hutId, '2025-03-15T14:00:00', '2025-03-15T16:00:00');
 * if (!result.available) {
 *   result.conflicts.forEach(c => {
 *     if (c.type === 'google-event') {
 *       console.log('Time not available (owner has personal commitment)');
 *     } else {
 *       console.log(`Conflict with ${c.type}: ${c.title}`);
 *     }
 *   });
 * }
 */
async function checkAvailability(hutId, requestedStart, requestedEnd, options = {}) {
    const conflicts = [];
    
    // Normalize times to Date objects
    const startDate = new Date(requestedStart);
    const endDate = new Date(requestedEnd);
    
    // Validate inputs
    if (!hutId) {
        console.error('[checkAvailability] hutId is required');
        return { available: false, conflicts: [{ type: 'error', title: 'Invalid request' }] };
    }
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.error('[checkAvailability] Invalid date format');
        return { available: false, conflicts: [{ type: 'error', title: 'Invalid date format' }] };
    }
    
    // =========================================================================
    // CHECK 1: Query bookings table for confirmed AND pending bookings that overlap
    // Overlap condition: booking starts before requested end AND ends after requested start
    // =========================================================================
    try {
        let query = supabaseClient
            .from('bookings')
            .select('id, event_name, contact_name, start_time, end_time, status')
            .eq('hut_id', hutId)
            .in('status', ['confirmed', 'pending'])
            .lt('start_time', endDate.toISOString())    // Booking starts before requested end
            .gt('end_time', startDate.toISOString());   // Booking ends after requested start
        
        // Exclude a specific booking (useful when checking availability for an update)
        if (options.excludeBookingId) {
            query = query.neq('id', options.excludeBookingId);
        }
        
        const { data: bookings, error } = await query;
        
        if (error) {
            console.error('[checkAvailability] Error querying bookings:', error);
        } else if (bookings && bookings.length > 0) {
            for (const booking of bookings) {
                conflicts.push({
                    type: 'booking',
                    title: booking.event_name,
                    start: booking.start_time,
                    end: booking.end_time,
                    contact: booking.contact_name || null
                });
            }
        }
    } catch (err) {
        console.error('[checkAvailability] Unexpected error checking bookings:', err);
    }
    
    // =========================================================================
    // CHECK 2: Query synced_events for Google Calendar events imported from owner
    // Only check events with event_type = 'google_to_scout' (imported from Google)
    // These represent times when the hut owner has personal commitments
    // =========================================================================
    try {
        const { data: syncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('id, title, start_time, end_time')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout')  // Only events imported FROM Google
            .lt('start_time', endDate.toISOString())    // Event starts before requested end
            .gt('end_time', startDate.toISOString());   // Event ends after requested start
        
        if (syncedError) {
            console.error('[checkAvailability] Error querying synced_events:', syncedError);
        } else if (syncedEvents && syncedEvents.length > 0) {
            for (const event of syncedEvents) {
                // PRIVACY: Don't expose actual Google event details to public users
                // Store the real title in _internalTitle for owner's use only
                conflicts.push({
                    type: 'google-event',
                    title: 'Owner has personal commitment',  // Generic message for privacy
                    start: event.start_time,
                    end: event.end_time,
                    _internalTitle: event.title  // Actual title (for owner's view only)
                });
            }
        }
    } catch (err) {
        console.error('[checkAvailability] Unexpected error checking synced events:', err);
    }
    
    // =========================================================================
    // CHECK 3: Weekly sessions (if hut object provided)
    // These are recurring scout group meetings that block time every week
    // =========================================================================
    if (options.hut && options.hut.weekly_sessions) {
        // Format date as YYYY-MM-DD in local time (consistent with getDay())
        const year = startDate.getFullYear();
        const month = String(startDate.getMonth() + 1).padStart(2, '0');
        const day = String(startDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[startDate.getDay()];
        
        const groupDisplayNames = {
            squirrels: 'Squirrels',
            beavers: 'Beavers',
            cubs: 'Cubs',
            scouts: 'Scouts'
        };
        
        for (const [group, config] of Object.entries(options.hut.weekly_sessions)) {
            if (config.enabled && config.day === dayName) {
                const sessionStart = new Date(`${dateStr}T${config.start_time}`);
                const sessionEnd = new Date(`${dateStr}T${config.end_time}`);
                
                // Check for overlap
                if (startDate < sessionEnd && endDate > sessionStart) {
                    conflicts.push({
                        type: 'session',
                        title: `${groupDisplayNames[group]} session`,
                        start: sessionStart.toISOString(),
                        end: sessionEnd.toISOString()
                    });
                }
            }
        }
    }
    
    return {
        available: conflicts.length === 0,
        conflicts
    };
}

/**
 * Formats a conflict message for display to users.
 * Handles different conflict types with appropriate messaging.
 * 
 * @param {Object} conflict - A conflict object from checkAvailability
 * @returns {string} Human-readable conflict message
 */
function formatConflictMessage(conflict) {
    const startTime = new Date(conflict.start).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    const endTime = new Date(conflict.end).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    const timeRange = `${startTime} - ${endTime}`;
    
    switch (conflict.type) {
        case 'booking':
            return `Existing booking: "${conflict.title}" (${timeRange})`;
        
        case 'google-event':
            // PRIVACY: Don't reveal Google event details to public users
            return `Time not available (owner has personal commitment) - ${timeRange}`;
        
        case 'session':
            return `${conflict.title} (${timeRange})`;
        
        default:
            return `Time unavailable: ${timeRange}`;
    }
}

// =============================================================================
// FORMAT BOOKING FOR DISPLAY
// =============================================================================

/**
 * Formats a booking's date/time for display.
 * 
 * @param {Object} booking - The booking object
 * @returns {string} Formatted date/time string
 */
function formatBookingDateTime(booking) {
    if (!booking || !booking.start_time) {
        return '';
    }

    const start = new Date(booking.start_time);
    const end = new Date(booking.end_time);

    // Format: "Mon, 10 Feb 2025"
    const dateOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    const dateStr = start.toLocaleDateString('en-GB', dateOptions);

    // Format times: "9:00am - 5:00pm"
    const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    const startTime = start.toLocaleTimeString('en-GB', timeOptions).toLowerCase();
    const endTime = end.toLocaleTimeString('en-GB', timeOptions).toLowerCase();

    return `${dateStr}, ${startTime} - ${endTime}`;
}

/**
 * Gets the status badge class for a booking status.
 * 
 * @param {string} status - The booking status
 * @returns {string} CSS class for the badge
 */
function getBookingStatusClass(status) {
    switch (status) {
        case 'confirmed':
            return 'badge-success';
        case 'pending':
            return 'badge-warning';
        case 'cancelled':
            return 'badge-danger';
        default:
            return 'badge-neutral';
    }
}
