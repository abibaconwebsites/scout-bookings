/**
 * Scout Bookings - Google Calendar Two-Way Sync System
 * 
 * This module provides comprehensive two-way synchronization between
 * Scout Bookings and Google Calendar. It handles:
 * - OAuth token management (save, retrieve, refresh)
 * - Reading events from Google Calendar
 * - Writing events to Google Calendar
 * - Two-way sync logic between systems
 * - Availability checking with synced events
 * 
 * @module calendar
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Google OAuth configuration
 * In production, these should be loaded from environment variables
 */
const GOOGLE_OAUTH_CONFIG = {
    clientId: 'YOUR_GOOGLE_CLIENT_ID', // Replace with actual client ID
    clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET', // Replace with actual client secret
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    calendarApiBase: 'https://www.googleapis.com/calendar/v3'
};

/**
 * Default token expiry time in seconds (1 hour)
 */
const TOKEN_EXPIRY_SECONDS = 3600;

/**
 * Default sync window in days (how far ahead to sync)
 */
const SYNC_WINDOW_DAYS = 90;

// =============================================================================
// PART 1: TOKEN MANAGEMENT
// =============================================================================

/**
 * Saves Google Calendar OAuth tokens for a user.
 * Uses upsert to handle both new tokens and token updates.
 * 
 * @param {string} userId - The user's ID
 * @param {string} accessToken - The OAuth access token
 * @param {string} refreshToken - The OAuth refresh token
 * @returns {Promise<{success: boolean, error?: string}>}
 * 
 * @example
 * const result = await saveCalendarTokens(userId, accessToken, refreshToken);
 * if (result.success) {
 *   console.log('Tokens saved successfully');
 * }
 */
async function saveCalendarTokens(userId, accessToken, refreshToken) {
    try {
        // Validate inputs
        if (!userId) {
            console.error('[Calendar] saveCalendarTokens: userId is required');
            return { success: false, error: 'User ID is required' };
        }
        if (!accessToken) {
            console.error('[Calendar] saveCalendarTokens: accessToken is required');
            return { success: false, error: 'Access token is required' };
        }
        if (!refreshToken) {
            console.error('[Calendar] saveCalendarTokens: refreshToken is required');
            return { success: false, error: 'Refresh token is required' };
        }

        // Calculate token expiry (current time + 3600 seconds)
        const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_SECONDS * 1000).toISOString();

        console.log(`[Calendar] Saving tokens for user ${userId}, expires at ${tokenExpiresAt}`);

        // Upsert tokens - insert or update on conflict
        const { error } = await supabaseClient
            .from('calendar_tokens')
            .upsert({
                user_id: userId,
                access_token: accessToken,
                refresh_token: refreshToken,
                token_expires_at: tokenExpiresAt,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });

        if (error) {
            console.error('[Calendar] Error saving tokens:', error);
            return { success: false, error: error.message || 'Failed to save tokens' };
        }

        console.log('[Calendar] Tokens saved successfully');
        return { success: true };

    } catch (err) {
        console.error('[Calendar] Unexpected error saving tokens:', err);
        return { success: false, error: 'An unexpected error occurred while saving tokens' };
    }
}

/**
 * Retrieves valid Google Calendar tokens for a user.
 * Automatically refreshes expired tokens.
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<string|null>} Valid access token or null if unavailable
 * 
 * @example
 * const accessToken = await getCalendarTokens(userId);
 * if (accessToken) {
 *   // Use token to make API calls
 * } else {
 *   // User needs to re-authenticate
 * }
 */
async function getCalendarTokens(userId) {
    try {
        // Validate input
        if (!userId) {
            console.error('[Calendar] getCalendarTokens: userId is required');
            return null;
        }

        console.log(`[Calendar] Fetching tokens for user ${userId}`);

        // Query calendar_tokens for the user
        const { data, error } = await supabaseClient
            .from('calendar_tokens')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No rows returned - user hasn't connected Google Calendar
                console.log('[Calendar] No tokens found for user - needs to authenticate');
                return null;
            }
            console.error('[Calendar] Error fetching tokens:', error);
            return null;
        }

        if (!data) {
            console.log('[Calendar] No token data found for user');
            return null;
        }

        // Check if token is expired
        const tokenExpiresAt = new Date(data.token_expires_at);
        const now = new Date();
        
        // Add 5-minute buffer to avoid edge cases
        const bufferMs = 5 * 60 * 1000;
        const isExpired = tokenExpiresAt.getTime() - bufferMs < now.getTime();

        if (isExpired) {
            console.log('[Calendar] Token expired, refreshing...');
            const newAccessToken = await refreshCalendarToken(userId);
            return newAccessToken;
        }

        console.log('[Calendar] Returning valid access token');
        return data.access_token;

    } catch (err) {
        console.error('[Calendar] Unexpected error getting tokens:', err);
        return null;
    }
}

/**
 * Refreshes an expired Google Calendar access token.
 * Uses the stored refresh token to obtain a new access token.
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<string|null>} New access token or null if refresh failed
 * 
 * @example
 * const newToken = await refreshCalendarToken(userId);
 * if (!newToken) {
 *   // User needs to re-authenticate with Google
 * }
 */
async function refreshCalendarToken(userId) {
    try {
        // Validate input
        if (!userId) {
            console.error('[Calendar] refreshCalendarToken: userId is required');
            return null;
        }

        console.log(`[Calendar] Refreshing token for user ${userId}`);

        // Get current refresh token from database
        const { data, error } = await supabaseClient
            .from('calendar_tokens')
            .select('refresh_token')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            console.error('[Calendar] Could not find refresh token:', error);
            return null;
        }

        const refreshToken = data.refresh_token;

        // Request new access token from Google
        const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                refresh_token: refreshToken,
                client_id: GOOGLE_OAUTH_CONFIG.clientId,
                client_secret: GOOGLE_OAUTH_CONFIG.clientSecret,
                grant_type: 'refresh_token'
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Token refresh failed:', response.status, errorData);
            
            // If refresh token is invalid, user needs to re-authenticate
            if (response.status === 400 || response.status === 401) {
                console.log('[Calendar] Refresh token invalid - user needs to re-authenticate');
                // Optionally delete the invalid tokens
                await supabaseClient
                    .from('calendar_tokens')
                    .delete()
                    .eq('user_id', userId);
            }
            return null;
        }

        const tokenData = await response.json();
        const newAccessToken = tokenData.access_token;
        
        // Google may return a new refresh token (though usually doesn't)
        const newRefreshToken = tokenData.refresh_token || refreshToken;

        // Calculate new expiry time
        const expiresIn = tokenData.expires_in || TOKEN_EXPIRY_SECONDS;
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        // Update database with new access token and expiry
        const { error: updateError } = await supabaseClient
            .from('calendar_tokens')
            .update({
                access_token: newAccessToken,
                refresh_token: newRefreshToken,
                token_expires_at: tokenExpiresAt,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);

        if (updateError) {
            console.error('[Calendar] Error updating refreshed token:', updateError);
            // Still return the token even if we couldn't save it
        }

        console.log('[Calendar] Token refreshed successfully');
        return newAccessToken;

    } catch (err) {
        console.error('[Calendar] Unexpected error refreshing token:', err);
        return null;
    }
}

/**
 * Removes Google Calendar tokens for a user (disconnect).
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function removeCalendarTokens(userId) {
    try {
        if (!userId) {
            return { success: false, error: 'User ID is required' };
        }

        console.log(`[Calendar] Removing tokens for user ${userId}`);

        const { error } = await supabaseClient
            .from('calendar_tokens')
            .delete()
            .eq('user_id', userId);

        if (error) {
            console.error('[Calendar] Error removing tokens:', error);
            return { success: false, error: error.message };
        }

        console.log('[Calendar] Tokens removed successfully');
        return { success: true };

    } catch (err) {
        console.error('[Calendar] Unexpected error removing tokens:', err);
        return { success: false, error: 'An unexpected error occurred' };
    }
}

// =============================================================================
// PART 2: GOOGLE CALENDAR API - READ (Google → Scout)
// =============================================================================

/**
 * Lists all calendars accessible by the user.
 * 
 * @param {string} accessToken - Valid Google OAuth access token
 * @returns {Promise<Array<{id: string, summary: string, primary: boolean, backgroundColor: string}>|null>}
 * 
 * @example
 * const calendars = await listUserCalendars(accessToken);
 * calendars.forEach(cal => console.log(cal.summary));
 */
async function listUserCalendars(accessToken) {
    try {
        // Validate input
        if (!accessToken) {
            console.error('[Calendar] listUserCalendars: accessToken is required');
            return null;
        }

        console.log('[Calendar] Fetching user calendars...');

        const response = await fetch(
            `${GOOGLE_OAUTH_CONFIG.calendarApiBase}/users/me/calendarList`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Failed to fetch calendars:', response.status, errorData);
            
            if (response.status === 401) {
                console.log('[Calendar] Access token expired or invalid');
            }
            return null;
        }

        const data = await response.json();
        
        // Map to simplified format
        const calendars = (data.items || []).map(cal => ({
            id: cal.id,
            summary: cal.summary || 'Untitled Calendar',
            primary: cal.primary || false,
            backgroundColor: cal.backgroundColor || '#4285f4',
            accessRole: cal.accessRole
        }));

        console.log(`[Calendar] Found ${calendars.length} calendars`);
        return calendars;

    } catch (err) {
        console.error('[Calendar] Unexpected error listing calendars:', err);
        return null;
    }
}

/**
 * Fetches events from a Google Calendar within a time range.
 * Filters out all-day events (only returns timed events).
 * 
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID (e.g., 'primary')
 * @param {string} timeMin - Start of time range (ISO datetime)
 * @param {string} timeMax - End of time range (ISO datetime)
 * @returns {Promise<Array<{id: string, summary: string, start: {dateTime: string}, end: {dateTime: string}, description: string}>|null>}
 * 
 * @example
 * const events = await fetchGoogleCalendarEvents(
 *   accessToken,
 *   'primary',
 *   '2026-02-01T00:00:00Z',
 *   '2026-05-01T23:59:59Z'
 * );
 */
async function fetchGoogleCalendarEvents(accessToken, calendarId, timeMin, timeMax) {
    try {
        // Validate inputs
        if (!accessToken) {
            console.error('[Calendar] fetchGoogleCalendarEvents: accessToken is required');
            return null;
        }
        if (!calendarId) {
            console.error('[Calendar] fetchGoogleCalendarEvents: calendarId is required');
            return null;
        }
        if (!timeMin || !timeMax) {
            console.error('[Calendar] fetchGoogleCalendarEvents: timeMin and timeMax are required');
            return null;
        }

        console.log(`[Calendar] Fetching events from ${calendarId} between ${timeMin} and ${timeMax}`);

        // Build query parameters
        const params = new URLSearchParams({
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: 'true', // Expand recurring events
            orderBy: 'startTime',
            maxResults: '2500' // Maximum allowed by Google
        });

        const encodedCalendarId = encodeURIComponent(calendarId);
        const url = `${GOOGLE_OAUTH_CONFIG.calendarApiBase}/calendars/${encodedCalendarId}/events?${params}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Failed to fetch events:', response.status, errorData);
            
            if (response.status === 401) {
                console.log('[Calendar] Access token expired or invalid');
            } else if (response.status === 404) {
                console.log('[Calendar] Calendar not found');
            } else if (response.status === 403) {
                console.log('[Calendar] Access denied to calendar');
            }
            return null;
        }

        const data = await response.json();
        
        // Filter out all-day events (only include events with dateTime, not date)
        // All-day events have start.date instead of start.dateTime
        const timedEvents = (data.items || [])
            .filter(event => event.start?.dateTime && event.end?.dateTime)
            .map(event => ({
                id: event.id,
                summary: event.summary || 'Untitled Event',
                start: { dateTime: event.start.dateTime },
                end: { dateTime: event.end.dateTime },
                description: event.description || '',
                status: event.status,
                htmlLink: event.htmlLink
            }));

        console.log(`[Calendar] Found ${timedEvents.length} timed events (filtered from ${data.items?.length || 0} total)`);
        return timedEvents;

    } catch (err) {
        console.error('[Calendar] Unexpected error fetching events:', err);
        return null;
    }
}

// =============================================================================
// PART 3: GOOGLE CALENDAR API - WRITE (Scout → Google)
// =============================================================================

/**
 * Creates a new event in Google Calendar.
 * 
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID
 * @param {Object} eventData - Event details
 * @param {string} eventData.summary - Event title
 * @param {string} eventData.description - Event description
 * @param {string} eventData.startTime - Start time (ISO datetime)
 * @param {string} eventData.endTime - End time (ISO datetime)
 * @returns {Promise<{success: boolean, event?: Object, error?: string}>}
 * 
 * @example
 * const result = await createGoogleCalendarEvent(accessToken, 'primary', {
 *   summary: 'Scout Meeting',
 *   description: 'Weekly cubs meeting',
 *   startTime: '2026-02-15T18:00:00Z',
 *   endTime: '2026-02-15T20:00:00Z'
 * });
 */
async function createGoogleCalendarEvent(accessToken, calendarId, eventData) {
    try {
        // Validate inputs
        if (!accessToken) {
            console.error('[Calendar] createGoogleCalendarEvent: accessToken is required');
            return { success: false, error: 'Access token is required' };
        }
        if (!calendarId) {
            console.error('[Calendar] createGoogleCalendarEvent: calendarId is required');
            return { success: false, error: 'Calendar ID is required' };
        }
        if (!eventData?.summary) {
            console.error('[Calendar] createGoogleCalendarEvent: event summary is required');
            return { success: false, error: 'Event summary is required' };
        }
        if (!eventData?.startTime || !eventData?.endTime) {
            console.error('[Calendar] createGoogleCalendarEvent: start and end times are required');
            return { success: false, error: 'Start and end times are required' };
        }

        console.log(`[Calendar] Creating event "${eventData.summary}" in calendar ${calendarId}`);

        // Build event body
        const eventBody = {
            summary: eventData.summary,
            description: eventData.description || '',
            start: {
                dateTime: eventData.startTime,
                timeZone: 'Europe/London'
            },
            end: {
                dateTime: eventData.endTime,
                timeZone: 'Europe/London'
            }
        };

        const encodedCalendarId = encodeURIComponent(calendarId);
        const url = `${GOOGLE_OAUTH_CONFIG.calendarApiBase}/calendars/${encodedCalendarId}/events`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Failed to create event:', response.status, errorData);
            
            let errorMessage = 'Failed to create event';
            if (response.status === 401) {
                errorMessage = 'Access token expired or invalid';
            } else if (response.status === 403) {
                errorMessage = 'No permission to create events in this calendar';
            } else if (response.status === 404) {
                errorMessage = 'Calendar not found';
            } else if (errorData.error?.message) {
                errorMessage = errorData.error.message;
            }
            
            return { success: false, error: errorMessage };
        }

        const createdEvent = await response.json();
        console.log(`[Calendar] Event created successfully with ID: ${createdEvent.id}`);

        return {
            success: true,
            event: {
                id: createdEvent.id,
                summary: createdEvent.summary,
                start: createdEvent.start,
                end: createdEvent.end,
                htmlLink: createdEvent.htmlLink
            }
        };

    } catch (err) {
        console.error('[Calendar] Unexpected error creating event:', err);
        return { success: false, error: 'An unexpected error occurred while creating the event' };
    }
}

/**
 * Updates an existing event in Google Calendar.
 * 
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID
 * @param {string} eventId - The Google Calendar event ID
 * @param {Object} eventData - Updated event details
 * @param {string} eventData.summary - Event title
 * @param {string} eventData.description - Event description
 * @param {string} eventData.startTime - Start time (ISO datetime)
 * @param {string} eventData.endTime - End time (ISO datetime)
 * @returns {Promise<{success: boolean, event?: Object, error?: string}>}
 * 
 * @example
 * const result = await updateGoogleCalendarEvent(accessToken, 'primary', 'eventId123', {
 *   summary: 'Updated Meeting Title',
 *   startTime: '2026-02-15T19:00:00Z',
 *   endTime: '2026-02-15T21:00:00Z'
 * });
 */
async function updateGoogleCalendarEvent(accessToken, calendarId, eventId, eventData) {
    try {
        // Validate inputs
        if (!accessToken) {
            console.error('[Calendar] updateGoogleCalendarEvent: accessToken is required');
            return { success: false, error: 'Access token is required' };
        }
        if (!calendarId) {
            console.error('[Calendar] updateGoogleCalendarEvent: calendarId is required');
            return { success: false, error: 'Calendar ID is required' };
        }
        if (!eventId) {
            console.error('[Calendar] updateGoogleCalendarEvent: eventId is required');
            return { success: false, error: 'Event ID is required' };
        }
        if (!eventData?.summary) {
            console.error('[Calendar] updateGoogleCalendarEvent: event summary is required');
            return { success: false, error: 'Event summary is required' };
        }
        if (!eventData?.startTime || !eventData?.endTime) {
            console.error('[Calendar] updateGoogleCalendarEvent: start and end times are required');
            return { success: false, error: 'Start and end times are required' };
        }

        console.log(`[Calendar] Updating event ${eventId} in calendar ${calendarId}`);

        // Build event body
        const eventBody = {
            summary: eventData.summary,
            description: eventData.description || '',
            start: {
                dateTime: eventData.startTime,
                timeZone: 'Europe/London'
            },
            end: {
                dateTime: eventData.endTime,
                timeZone: 'Europe/London'
            }
        };

        const encodedCalendarId = encodeURIComponent(calendarId);
        const encodedEventId = encodeURIComponent(eventId);
        const url = `${GOOGLE_OAUTH_CONFIG.calendarApiBase}/calendars/${encodedCalendarId}/events/${encodedEventId}`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Failed to update event:', response.status, errorData);
            
            let errorMessage = 'Failed to update event';
            if (response.status === 401) {
                errorMessage = 'Access token expired or invalid';
            } else if (response.status === 403) {
                errorMessage = 'No permission to update this event';
            } else if (response.status === 404) {
                errorMessage = 'Event not found';
            } else if (errorData.error?.message) {
                errorMessage = errorData.error.message;
            }
            
            return { success: false, error: errorMessage };
        }

        const updatedEvent = await response.json();
        console.log(`[Calendar] Event updated successfully: ${updatedEvent.id}`);

        return {
            success: true,
            event: {
                id: updatedEvent.id,
                summary: updatedEvent.summary,
                start: updatedEvent.start,
                end: updatedEvent.end,
                htmlLink: updatedEvent.htmlLink
            }
        };

    } catch (err) {
        console.error('[Calendar] Unexpected error updating event:', err);
        return { success: false, error: 'An unexpected error occurred while updating the event' };
    }
}

/**
 * Deletes an event from Google Calendar.
 * 
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID
 * @param {string} eventId - The Google Calendar event ID
 * @returns {Promise<{success: boolean, error?: string}>}
 * 
 * @example
 * const result = await deleteGoogleCalendarEvent(accessToken, 'primary', 'eventId123');
 * if (result.success) {
 *   console.log('Event deleted');
 * }
 */
async function deleteGoogleCalendarEvent(accessToken, calendarId, eventId) {
    try {
        // Validate inputs
        if (!accessToken) {
            console.error('[Calendar] deleteGoogleCalendarEvent: accessToken is required');
            return { success: false, error: 'Access token is required' };
        }
        if (!calendarId) {
            console.error('[Calendar] deleteGoogleCalendarEvent: calendarId is required');
            return { success: false, error: 'Calendar ID is required' };
        }
        if (!eventId) {
            console.error('[Calendar] deleteGoogleCalendarEvent: eventId is required');
            return { success: false, error: 'Event ID is required' };
        }

        console.log(`[Calendar] Deleting event ${eventId} from calendar ${calendarId}`);

        const encodedCalendarId = encodeURIComponent(calendarId);
        const encodedEventId = encodeURIComponent(eventId);
        const url = `${GOOGLE_OAUTH_CONFIG.calendarApiBase}/calendars/${encodedCalendarId}/events/${encodedEventId}`;

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        // 204 No Content = success, 404 = already deleted (also OK)
        if (response.status === 204 || response.status === 404) {
            if (response.status === 404) {
                console.log('[Calendar] Event was already deleted');
            } else {
                console.log('[Calendar] Event deleted successfully');
            }
            return { success: true };
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Calendar] Failed to delete event:', response.status, errorData);
            
            let errorMessage = 'Failed to delete event';
            if (response.status === 401) {
                errorMessage = 'Access token expired or invalid';
            } else if (response.status === 403) {
                errorMessage = 'No permission to delete this event';
            } else if (errorData.error?.message) {
                errorMessage = errorData.error.message;
            }
            
            return { success: false, error: errorMessage };
        }

        return { success: true };

    } catch (err) {
        console.error('[Calendar] Unexpected error deleting event:', err);
        return { success: false, error: 'An unexpected error occurred while deleting the event' };
    }
}

// =============================================================================
// PART 4: TWO-WAY SYNC LOGIC
// =============================================================================

/**
 * Syncs events FROM Google Calendar TO Scout Bookings.
 * Imports Google Calendar events as blocked times in Scout.
 * 
 * @param {string} hutId - The Scout hut ID
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID to sync from
 * @returns {Promise<{success: boolean, imported: number, updated: number, deleted: number, error?: string}>}
 * 
 * @example
 * const result = await syncFromGoogleCalendar(hutId, accessToken, 'primary');
 * console.log(`Imported: ${result.imported}, Updated: ${result.updated}, Deleted: ${result.deleted}`);
 */
async function syncFromGoogleCalendar(hutId, accessToken, calendarId) {
    try {
        // Validate inputs
        if (!hutId) {
            console.error('[Calendar] syncFromGoogleCalendar: hutId is required');
            return { success: false, imported: 0, updated: 0, deleted: 0, error: 'Hut ID is required' };
        }
        if (!accessToken) {
            console.error('[Calendar] syncFromGoogleCalendar: accessToken is required');
            return { success: false, imported: 0, updated: 0, deleted: 0, error: 'Access token is required' };
        }
        if (!calendarId) {
            console.error('[Calendar] syncFromGoogleCalendar: calendarId is required');
            return { success: false, imported: 0, updated: 0, deleted: 0, error: 'Calendar ID is required' };
        }

        console.log(`[Calendar] Starting sync FROM Google Calendar for hut ${hutId}`);

        // Calculate time range: now to 90 days ahead
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        // Fetch events from Google Calendar
        const googleEvents = await fetchGoogleCalendarEvents(accessToken, calendarId, timeMin, timeMax);
        
        if (googleEvents === null) {
            return { success: false, imported: 0, updated: 0, deleted: 0, error: 'Failed to fetch events from Google Calendar' };
        }

        console.log(`[Calendar] Processing ${googleEvents.length} events from Google Calendar`);

        // Get existing synced events for this hut
        const { data: existingSyncedEvents, error: fetchError } = await supabaseClient
            .from('synced_events')
            .select('*')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout');

        if (fetchError) {
            console.error('[Calendar] Error fetching existing synced events:', fetchError);
            return { success: false, imported: 0, updated: 0, deleted: 0, error: 'Failed to fetch existing synced events' };
        }

        // Create a map of existing synced events by Google event ID
        const existingMap = new Map();
        (existingSyncedEvents || []).forEach(event => {
            existingMap.set(event.google_event_id, event);
        });

        // Track Google event IDs we've seen (for deletion detection)
        const seenGoogleEventIds = new Set();

        let imported = 0;
        let updated = 0;
        let deleted = 0;

        // Process each Google event
        for (const googleEvent of googleEvents) {
            seenGoogleEventIds.add(googleEvent.id);
            
            const existingSynced = existingMap.get(googleEvent.id);
            const startTime = googleEvent.start.dateTime;
            const endTime = googleEvent.end.dateTime;

            if (existingSynced) {
                // Event exists - check if times have changed
                const existingStart = new Date(existingSynced.start_time).toISOString();
                const existingEnd = new Date(existingSynced.end_time).toISOString();
                const newStart = new Date(startTime).toISOString();
                const newEnd = new Date(endTime).toISOString();

                if (existingStart !== newStart || existingEnd !== newEnd || existingSynced.title !== googleEvent.summary) {
                    // Times or title changed - update
                    const { error: updateError } = await supabaseClient
                        .from('synced_events')
                        .update({
                            start_time: startTime,
                            end_time: endTime,
                            title: googleEvent.summary,
                            last_synced_at: new Date().toISOString()
                        })
                        .eq('id', existingSynced.id);

                    if (updateError) {
                        console.error(`[Calendar] Error updating synced event ${existingSynced.id}:`, updateError);
                    } else {
                        updated++;
                        console.log(`[Calendar] Updated synced event: ${googleEvent.summary}`);
                    }
                }
            } else {
                // New event - insert into synced_events
                const { error: insertError } = await supabaseClient
                    .from('synced_events')
                    .insert({
                        hut_id: hutId,
                        google_event_id: googleEvent.id,
                        event_type: 'google_to_scout',
                        start_time: startTime,
                        end_time: endTime,
                        title: googleEvent.summary,
                        last_synced_at: new Date().toISOString()
                    });

                if (insertError) {
                    // Handle unique constraint violation (event already exists)
                    if (insertError.code === '23505') {
                        console.log(`[Calendar] Event ${googleEvent.id} already exists, skipping`);
                    } else {
                        console.error(`[Calendar] Error inserting synced event:`, insertError);
                    }
                } else {
                    imported++;
                    console.log(`[Calendar] Imported event: ${googleEvent.summary}`);
                }
            }
        }

        // Find and delete synced events that no longer exist in Google
        for (const [googleEventId, syncedEvent] of existingMap) {
            if (!seenGoogleEventIds.has(googleEventId)) {
                // Event was deleted in Google - remove from synced_events
                const { error: deleteError } = await supabaseClient
                    .from('synced_events')
                    .delete()
                    .eq('id', syncedEvent.id);

                if (deleteError) {
                    console.error(`[Calendar] Error deleting synced event ${syncedEvent.id}:`, deleteError);
                } else {
                    deleted++;
                    console.log(`[Calendar] Deleted synced event: ${syncedEvent.title} (removed from Google)`);
                }
            }
        }

        // Update last_sync_at on the hut
        await supabaseClient
            .from('scout_huts')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', hutId);

        console.log(`[Calendar] Sync FROM Google complete - Imported: ${imported}, Updated: ${updated}, Deleted: ${deleted}`);

        return { success: true, imported, updated, deleted };

    } catch (err) {
        console.error('[Calendar] Unexpected error syncing from Google:', err);
        return { success: false, imported: 0, updated: 0, deleted: 0, error: 'An unexpected error occurred during sync' };
    }
}

/**
 * Syncs events FROM Scout Bookings TO Google Calendar.
 * Exports confirmed Scout bookings to Google Calendar.
 * 
 * @param {string} hutId - The Scout hut ID
 * @param {string} accessToken - Valid Google OAuth access token
 * @param {string} calendarId - The Google Calendar ID to sync to
 * @returns {Promise<{success: boolean, created: number, updated: number, deleted: number, error?: string}>}
 * 
 * @example
 * const result = await syncToGoogleCalendar(hutId, accessToken, 'primary');
 * console.log(`Created: ${result.created}, Updated: ${result.updated}, Deleted: ${result.deleted}`);
 */
async function syncToGoogleCalendar(hutId, accessToken, calendarId) {
    try {
        // Validate inputs
        if (!hutId) {
            console.error('[Calendar] syncToGoogleCalendar: hutId is required');
            return { success: false, created: 0, updated: 0, deleted: 0, error: 'Hut ID is required' };
        }
        if (!accessToken) {
            console.error('[Calendar] syncToGoogleCalendar: accessToken is required');
            return { success: false, created: 0, updated: 0, deleted: 0, error: 'Access token is required' };
        }
        if (!calendarId) {
            console.error('[Calendar] syncToGoogleCalendar: calendarId is required');
            return { success: false, created: 0, updated: 0, deleted: 0, error: 'Calendar ID is required' };
        }

        console.log(`[Calendar] Starting sync TO Google Calendar for hut ${hutId}`);

        // Get confirmed bookings for this hut
        const { data: bookings, error: bookingsError } = await supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .eq('status', 'confirmed')
            .gte('start_time', new Date().toISOString()); // Only future bookings

        if (bookingsError) {
            console.error('[Calendar] Error fetching bookings:', bookingsError);
            return { success: false, created: 0, updated: 0, deleted: 0, error: 'Failed to fetch bookings' };
        }

        console.log(`[Calendar] Processing ${bookings?.length || 0} confirmed bookings`);

        // Get existing synced events for this hut (scout_to_google type)
        const { data: existingSyncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('*')
            .eq('hut_id', hutId)
            .eq('event_type', 'scout_to_google');

        if (syncedError) {
            console.error('[Calendar] Error fetching synced events:', syncedError);
            return { success: false, created: 0, updated: 0, deleted: 0, error: 'Failed to fetch synced events' };
        }

        // Create maps for quick lookup
        const syncedByBookingId = new Map();
        (existingSyncedEvents || []).forEach(event => {
            if (event.booking_id) {
                syncedByBookingId.set(event.booking_id, event);
            }
        });

        // Track booking IDs we've processed (for deletion detection)
        const processedBookingIds = new Set();

        let created = 0;
        let updated = 0;
        let deleted = 0;

        // Process each booking
        for (const booking of (bookings || [])) {
            processedBookingIds.add(booking.id);
            
            const existingSynced = syncedByBookingId.get(booking.id);
            
            const eventData = {
                summary: `Scout Booking: ${booking.event_name}`,
                description: `Contact: ${booking.contact_name || 'N/A'}\nEmail: ${booking.contact_email || 'N/A'}\nPhone: ${booking.contact_phone || 'N/A'}\n\n${booking.notes || ''}`.trim(),
                startTime: booking.start_time,
                endTime: booking.end_time
            };

            if (existingSynced) {
                // Booking already synced - check if it needs updating
                const existingStart = new Date(existingSynced.start_time).toISOString();
                const existingEnd = new Date(existingSynced.end_time).toISOString();
                const bookingStart = new Date(booking.start_time).toISOString();
                const bookingEnd = new Date(booking.end_time).toISOString();

                if (existingStart !== bookingStart || existingEnd !== bookingEnd || existingSynced.title !== eventData.summary) {
                    // Booking has changed - update Google Calendar event
                    const updateResult = await updateGoogleCalendarEvent(
                        accessToken,
                        calendarId,
                        existingSynced.google_event_id,
                        eventData
                    );

                    if (updateResult.success) {
                        // Update synced_events record
                        await supabaseClient
                            .from('synced_events')
                            .update({
                                start_time: booking.start_time,
                                end_time: booking.end_time,
                                title: eventData.summary,
                                last_synced_at: new Date().toISOString()
                            })
                            .eq('id', existingSynced.id);

                        updated++;
                        console.log(`[Calendar] Updated Google event for booking: ${booking.event_name}`);
                    } else {
                        console.error(`[Calendar] Failed to update Google event: ${updateResult.error}`);
                    }
                }
            } else {
                // New booking - create Google Calendar event
                const createResult = await createGoogleCalendarEvent(accessToken, calendarId, eventData);

                if (createResult.success && createResult.event) {
                    // Insert into synced_events
                    const { error: insertError } = await supabaseClient
                        .from('synced_events')
                        .insert({
                            hut_id: hutId,
                            google_event_id: createResult.event.id,
                            booking_id: booking.id,
                            event_type: 'scout_to_google',
                            start_time: booking.start_time,
                            end_time: booking.end_time,
                            title: eventData.summary,
                            last_synced_at: new Date().toISOString()
                        });

                    if (insertError) {
                        console.error(`[Calendar] Error inserting synced event record:`, insertError);
                    } else {
                        created++;
                        console.log(`[Calendar] Created Google event for booking: ${booking.event_name}`);
                    }
                } else {
                    console.error(`[Calendar] Failed to create Google event: ${createResult.error}`);
                }
            }
        }

        // Find synced events where the booking was deleted
        for (const [bookingId, syncedEvent] of syncedByBookingId) {
            if (!processedBookingIds.has(bookingId)) {
                // Booking was deleted or cancelled - delete from Google Calendar
                const deleteResult = await deleteGoogleCalendarEvent(
                    accessToken,
                    calendarId,
                    syncedEvent.google_event_id
                );

                if (deleteResult.success) {
                    // Delete from synced_events
                    await supabaseClient
                        .from('synced_events')
                        .delete()
                        .eq('id', syncedEvent.id);

                    deleted++;
                    console.log(`[Calendar] Deleted Google event for removed booking: ${syncedEvent.title}`);
                } else {
                    console.error(`[Calendar] Failed to delete Google event: ${deleteResult.error}`);
                }
            }
        }

        // Update last_sync_at on the hut
        await supabaseClient
            .from('scout_huts')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', hutId);

        console.log(`[Calendar] Sync TO Google complete - Created: ${created}, Updated: ${updated}, Deleted: ${deleted}`);

        return { success: true, created, updated, deleted };

    } catch (err) {
        console.error('[Calendar] Unexpected error syncing to Google:', err);
        return { success: false, created: 0, updated: 0, deleted: 0, error: 'An unexpected error occurred during sync' };
    }
}

/**
 * Performs a full two-way sync between Scout Bookings and Google Calendar.
 * 
 * @param {string} hutId - The Scout hut ID
 * @param {string} userId - The user's ID (to get tokens)
 * @returns {Promise<{success: boolean, fromGoogle: Object, toGoogle: Object, error?: string}>}
 * 
 * @example
 * const result = await performFullSync(hutId, userId);
 * if (result.success) {
 *   console.log('Sync completed:', result.fromGoogle, result.toGoogle);
 * }
 */
async function performFullSync(hutId, userId) {
    try {
        // Validate inputs
        if (!hutId || !userId) {
            return { 
                success: false, 
                fromGoogle: { imported: 0, updated: 0, deleted: 0 },
                toGoogle: { created: 0, updated: 0, deleted: 0 },
                error: 'Hut ID and User ID are required' 
            };
        }

        console.log(`[Calendar] Starting full two-way sync for hut ${hutId}`);

        // Get access token
        const accessToken = await getCalendarTokens(userId);
        if (!accessToken) {
            return { 
                success: false, 
                fromGoogle: { imported: 0, updated: 0, deleted: 0 },
                toGoogle: { created: 0, updated: 0, deleted: 0 },
                error: 'No valid access token - user needs to connect Google Calendar' 
            };
        }

        // Get hut's calendar configuration
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('google_calendar_id, sync_enabled, sync_direction')
            .eq('id', hutId)
            .single();

        if (hutError || !hut) {
            return { 
                success: false, 
                fromGoogle: { imported: 0, updated: 0, deleted: 0 },
                toGoogle: { created: 0, updated: 0, deleted: 0 },
                error: 'Hut not found or error fetching hut configuration' 
            };
        }

        if (!hut.sync_enabled) {
            return { 
                success: false, 
                fromGoogle: { imported: 0, updated: 0, deleted: 0 },
                toGoogle: { created: 0, updated: 0, deleted: 0 },
                error: 'Calendar sync is not enabled for this hut' 
            };
        }

        if (!hut.google_calendar_id) {
            return { 
                success: false, 
                fromGoogle: { imported: 0, updated: 0, deleted: 0 },
                toGoogle: { created: 0, updated: 0, deleted: 0 },
                error: 'No Google Calendar configured for this hut' 
            };
        }

        let fromGoogleResult = { imported: 0, updated: 0, deleted: 0 };
        let toGoogleResult = { created: 0, updated: 0, deleted: 0 };

        // Sync FROM Google (if direction allows)
        if (hut.sync_direction === 'both' || hut.sync_direction === 'from_google') {
            fromGoogleResult = await syncFromGoogleCalendar(hutId, accessToken, hut.google_calendar_id);
            if (!fromGoogleResult.success) {
                console.error('[Calendar] Sync from Google failed:', fromGoogleResult.error);
            }
        }

        // Sync TO Google (if direction allows)
        if (hut.sync_direction === 'both' || hut.sync_direction === 'to_google') {
            toGoogleResult = await syncToGoogleCalendar(hutId, accessToken, hut.google_calendar_id);
            if (!toGoogleResult.success) {
                console.error('[Calendar] Sync to Google failed:', toGoogleResult.error);
            }
        }

        console.log('[Calendar] Full sync completed');

        return {
            success: true,
            fromGoogle: {
                imported: fromGoogleResult.imported || 0,
                updated: fromGoogleResult.updated || 0,
                deleted: fromGoogleResult.deleted || 0
            },
            toGoogle: {
                created: toGoogleResult.created || 0,
                updated: toGoogleResult.updated || 0,
                deleted: toGoogleResult.deleted || 0
            }
        };

    } catch (err) {
        console.error('[Calendar] Unexpected error during full sync:', err);
        return { 
            success: false, 
            fromGoogle: { imported: 0, updated: 0, deleted: 0 },
            toGoogle: { created: 0, updated: 0, deleted: 0 },
            error: 'An unexpected error occurred during sync' 
        };
    }
}

// =============================================================================
// PART 5: AVAILABILITY CHECKING
// =============================================================================

/**
 * Checks availability for a time slot, including synced Google Calendar events.
 * This extends the basic conflict checking to include imported Google events.
 * 
 * @param {string} hutId - The Scout hut ID
 * @param {string} startTime - Start time (ISO datetime)
 * @param {string} endTime - End time (ISO datetime)
 * @param {string|null} excludeBookingId - Booking ID to exclude (for updates)
 * @returns {Promise<{available: boolean, conflicts: Array<{type: string, title: string, start: string, end: string}>}>}
 * 
 * @example
 * const result = await checkAvailabilityWithSync(hutId, '2026-02-15T18:00:00Z', '2026-02-15T20:00:00Z');
 * if (!result.available) {
 *   console.log('Conflicts:', result.conflicts);
 * }
 */
async function checkAvailabilityWithSync(hutId, startTime, endTime, excludeBookingId = null) {
    const conflicts = [];

    try {
        // Validate inputs
        if (!hutId) {
            console.error('[Calendar] checkAvailabilityWithSync: hutId is required');
            return { available: true, conflicts: [] };
        }
        if (!startTime || !endTime) {
            console.error('[Calendar] checkAvailabilityWithSync: startTime and endTime are required');
            return { available: true, conflicts: [] };
        }

        const propStart = new Date(startTime);
        const propEnd = new Date(endTime);

        console.log(`[Calendar] Checking availability for hut ${hutId} from ${startTime} to ${endTime}`);

        // 1. Check regular bookings
        let bookingsQuery = supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .eq('status', 'confirmed');

        if (excludeBookingId) {
            bookingsQuery = bookingsQuery.neq('id', excludeBookingId);
        }

        const { data: bookings, error: bookingsError } = await bookingsQuery;

        if (bookingsError) {
            console.error('[Calendar] Error checking bookings:', bookingsError);
        } else if (bookings) {
            for (const booking of bookings) {
                const bookingStart = new Date(booking.start_time);
                const bookingEnd = new Date(booking.end_time);

                // Check for overlap
                if (propStart < bookingEnd && propEnd > bookingStart) {
                    conflicts.push({
                        type: 'booking',
                        title: booking.event_name,
                        start: booking.start_time,
                        end: booking.end_time
                    });
                }
            }
        }

        // 2. Check synced Google Calendar events (google_to_scout type)
        const { data: syncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('*')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout');

        if (syncedError) {
            console.error('[Calendar] Error checking synced events:', syncedError);
        } else if (syncedEvents) {
            for (const event of syncedEvents) {
                const eventStart = new Date(event.start_time);
                const eventEnd = new Date(event.end_time);

                // Check for overlap
                if (propStart < eventEnd && propEnd > eventStart) {
                    conflicts.push({
                        type: 'google-event',
                        title: event.title || 'Google Calendar Event',
                        start: event.start_time,
                        end: event.end_time
                    });
                }
            }
        }

        // 3. Check weekly sessions (get hut data first)
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('weekly_sessions')
            .eq('id', hutId)
            .single();

        if (!hutError && hut?.weekly_sessions) {
            const dateObj = new Date(startTime);
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayName = dayNames[dateObj.getDay()];
            const dateStr = startTime.split('T')[0];

            const groupNames = {
                squirrels: 'Squirrels',
                beavers: 'Beavers',
                cubs: 'Cubs',
                scouts: 'Scouts'
            };

            for (const [group, config] of Object.entries(hut.weekly_sessions)) {
                if (config.enabled && config.day === dayName) {
                    const sessionStart = new Date(`${dateStr}T${config.start_time}`);
                    const sessionEnd = new Date(`${dateStr}T${config.end_time}`);

                    // Check for overlap
                    if (propStart < sessionEnd && propEnd > sessionStart) {
                        conflicts.push({
                            type: 'session',
                            title: `${groupNames[group]} Session`,
                            start: sessionStart.toISOString(),
                            end: sessionEnd.toISOString()
                        });
                    }
                }
            }
        }

        const available = conflicts.length === 0;
        console.log(`[Calendar] Availability check complete - Available: ${available}, Conflicts: ${conflicts.length}`);

        return { available, conflicts };

    } catch (err) {
        console.error('[Calendar] Unexpected error checking availability:', err);
        return { available: true, conflicts: [] };
    }
}

/**
 * Gets all blocked time slots for a date, including synced Google events.
 * 
 * @param {string} hutId - The Scout hut ID
 * @param {string} date - The date in YYYY-MM-DD format
 * @returns {Promise<Array<{type: string, name: string, start_time: string, end_time: string, color: string}>>}
 */
async function getBlockedTimeSlotsWithSync(hutId, date) {
    const blockedSlots = [];

    try {
        if (!hutId || !date) {
            return blockedSlots;
        }

        const dayStart = new Date(`${date}T00:00:00`).toISOString();
        const dayEnd = new Date(`${date}T23:59:59`).toISOString();

        // 1. Get existing bookings for that day
        const { data: bookings, error: bookingsError } = await supabaseClient
            .from('bookings')
            .select('*')
            .eq('hut_id', hutId)
            .gte('start_time', dayStart)
            .lte('start_time', dayEnd)
            .order('start_time', { ascending: true });

        if (!bookingsError && bookings) {
            for (const booking of bookings) {
                const start = new Date(booking.start_time);
                const end = new Date(booking.end_time);
                blockedSlots.push({
                    type: 'booking',
                    name: booking.event_name,
                    start_time: start.toTimeString().slice(0, 5),
                    end_time: end.toTimeString().slice(0, 5),
                    color: 'var(--color-primary)'
                });
            }
        }

        // 2. Get synced Google Calendar events for that day
        const { data: syncedEvents, error: syncedError } = await supabaseClient
            .from('synced_events')
            .select('*')
            .eq('hut_id', hutId)
            .eq('event_type', 'google_to_scout')
            .gte('start_time', dayStart)
            .lte('start_time', dayEnd)
            .order('start_time', { ascending: true });

        if (!syncedError && syncedEvents) {
            for (const event of syncedEvents) {
                const start = new Date(event.start_time);
                const end = new Date(event.end_time);
                blockedSlots.push({
                    type: 'google-event',
                    name: event.title || 'Google Calendar Event',
                    start_time: start.toTimeString().slice(0, 5),
                    end_time: end.toTimeString().slice(0, 5),
                    color: '#4285f4' // Google blue
                });
            }
        }

        // 3. Get weekly sessions for that day
        const { data: hut, error: hutError } = await supabaseClient
            .from('scout_huts')
            .select('weekly_sessions')
            .eq('id', hutId)
            .single();

        if (!hutError && hut?.weekly_sessions) {
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

    } catch (err) {
        console.error('[Calendar] Error getting blocked time slots:', err);
        return blockedSlots;
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Checks if a user has connected their Google Calendar.
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>}
 */
async function isGoogleCalendarConnected(userId) {
    try {
        if (!userId) return false;

        const { data, error } = await supabaseClient
            .from('calendar_tokens')
            .select('id')
            .eq('user_id', userId)
            .single();

        return !error && !!data;
    } catch (err) {
        console.error('[Calendar] Error checking calendar connection:', err);
        return false;
    }
}

/**
 * Gets the sync status for a hut.
 * 
 * @param {string} hutId - The hut's ID
 * @returns {Promise<{enabled: boolean, calendarId: string|null, direction: string, lastSync: string|null}>}
 */
async function getHutSyncStatus(hutId) {
    try {
        if (!hutId) {
            return { enabled: false, calendarId: null, direction: 'both', lastSync: null };
        }

        const { data, error } = await supabaseClient
            .from('scout_huts')
            .select('sync_enabled, google_calendar_id, sync_direction, last_sync_at')
            .eq('id', hutId)
            .single();

        if (error || !data) {
            return { enabled: false, calendarId: null, direction: 'both', lastSync: null };
        }

        return {
            enabled: data.sync_enabled || false,
            calendarId: data.google_calendar_id,
            direction: data.sync_direction || 'both',
            lastSync: data.last_sync_at
        };
    } catch (err) {
        console.error('[Calendar] Error getting sync status:', err);
        return { enabled: false, calendarId: null, direction: 'both', lastSync: null };
    }
}

/**
 * Updates the sync configuration for a hut.
 * 
 * @param {string} hutId - The hut's ID
 * @param {Object} config - Sync configuration
 * @param {boolean} config.enabled - Whether sync is enabled
 * @param {string} config.calendarId - Google Calendar ID
 * @param {string} config.direction - Sync direction ('both', 'from_google', 'to_google')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateHutSyncConfig(hutId, config) {
    try {
        if (!hutId) {
            return { success: false, error: 'Hut ID is required' };
        }

        const updateData = {};
        
        if (config.enabled !== undefined) {
            updateData.sync_enabled = config.enabled;
        }
        if (config.calendarId !== undefined) {
            updateData.google_calendar_id = config.calendarId;
        }
        if (config.direction !== undefined) {
            if (!['both', 'from_google', 'to_google'].includes(config.direction)) {
                return { success: false, error: 'Invalid sync direction' };
            }
            updateData.sync_direction = config.direction;
        }

        const { error } = await supabaseClient
            .from('scout_huts')
            .update(updateData)
            .eq('id', hutId);

        if (error) {
            console.error('[Calendar] Error updating sync config:', error);
            return { success: false, error: error.message };
        }

        console.log(`[Calendar] Updated sync config for hut ${hutId}`);
        return { success: true };

    } catch (err) {
        console.error('[Calendar] Unexpected error updating sync config:', err);
        return { success: false, error: 'An unexpected error occurred' };
    }
}

// =============================================================================
// EXPORTS (for module usage if needed)
// =============================================================================

// Make functions available globally for browser usage
if (typeof window !== 'undefined') {
    window.CalendarSync = {
        // Token management
        saveCalendarTokens,
        getCalendarTokens,
        refreshCalendarToken,
        removeCalendarTokens,
        
        // Google Calendar API - Read
        listUserCalendars,
        fetchGoogleCalendarEvents,
        
        // Google Calendar API - Write
        createGoogleCalendarEvent,
        updateGoogleCalendarEvent,
        deleteGoogleCalendarEvent,
        
        // Two-way sync
        syncFromGoogleCalendar,
        syncToGoogleCalendar,
        performFullSync,
        
        // Availability checking
        checkAvailabilityWithSync,
        getBlockedTimeSlotsWithSync,
        
        // Utilities
        isGoogleCalendarConnected,
        getHutSyncStatus,
        updateHutSyncConfig
    };
}
