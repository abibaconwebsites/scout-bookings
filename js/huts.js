/**
 * Scout Bookings huts: create and manage scout hut records.
 * Each user has exactly one hut (one-to-one relationship).
 */

// =============================================================================
// CREATE HUT
// =============================================================================

/**
 * Creates a new scout hut for the given user.
 * Each user can only have one hut (enforced by unique constraint on user_id).
 * 
 * @param {string} userId - The user's ID (from auth)
 * @param {Object} hutData - The hut data to create
 * @param {string} hutData.name - The hut name
 * @param {string} hutData.address_line1 - Street address
 * @param {string|null} hutData.address_line2 - Additional address info (optional)
 * @param {string} hutData.city - City/town
 * @param {string} hutData.postcode - Postcode
 * @param {Object} hutData.availability - Availability schedule by day
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 * 
 * @example
 * const result = await createHut(userId, {
 *   name: '1st Anytown Scout Hut',
 *   address_line1: '123 Scout Lane',
 *   address_line2: null,
 *   city: 'Anytown',
 *   postcode: 'AB1 2CD',
 *   availability: {
 *     monday: { enabled: true, start_time: '09:00', end_time: '21:00' },
 *     tuesday: { enabled: true, start_time: '09:00', end_time: '21:00' },
 *     // ... other days
 *   }
 * });
 */
async function createHut(userId, hutData) {
    try {
        // Validate required fields
        if (!userId) {
            return { data: null, error: { message: 'User ID is required' } };
        }

        if (!hutData.name || hutData.name.trim() === '') {
            return { data: null, error: { message: 'Hut name is required' } };
        }

        if (!hutData.address_line1 || !hutData.city || !hutData.postcode) {
            return { data: null, error: { message: 'Address details are required' } };
        }

        if (!hutData.slug || hutData.slug.trim() === '') {
            return { data: null, error: { message: 'Booking link URL is required' } };
        }

        // Use provided slug (already validated) or generate from name as fallback
        const slug = hutData.slug ? hutData.slug.toLowerCase().trim() : generateSlug(hutData.name);

        // Insert the hut record
        const { data, error } = await supabaseClient
            .from('scout_huts')
            .insert({
                owner_id: userId,
                name: hutData.name.trim(),
                slug: slug,
                address_line1: hutData.address_line1.trim(),
                address_line2: hutData.address_line2 ? hutData.address_line2.trim() : null,
                city: hutData.city.trim(),
                postcode: hutData.postcode.trim().toUpperCase(),
                availability: hutData.availability
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating hut:', error);
            
            // Handle unique constraint violation (user already has a hut)
            if (error.code === '23505') {
                return { data: null, error: { message: 'You already have a scout hut set up.' } };
            }
            
            return { data: null, error };
        }

        return { data, error: null };

    } catch (err) {
        console.error('Unexpected error creating hut:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

// =============================================================================
// GET USER'S HUT
// =============================================================================

/**
 * Gets the hut belonging to the specified user.
 * Returns null if the user doesn't have a hut yet.
 * 
 * @param {string} userId - The user's ID
 * @returns {Promise<Object|null>} The hut object or null if not found
 * 
 * @example
 * const hut = await getUserHut(userId);
 * if (hut) {
 *   console.log('Hut name:', hut.name);
 * } else {
 *   console.log('User has no hut');
 * }
 */
async function getUserHut(userId) {
    try {
        if (!userId) {
            return null;
        }

        const { data, error } = await supabaseClient
            .from('scout_huts')
            .select('*')
            .eq('owner_id', userId)
            .single();

        if (error) {
            // PGRST116 means no rows found - this is expected for new users
            if (error.code === 'PGRST116') {
                return null;
            }
            console.error('Error fetching user hut:', error);
            return null;
        }

        return data;

    } catch (err) {
        console.error('Unexpected error fetching user hut:', err);
        return null;
    }
}

// =============================================================================
// UPDATE HUT
// =============================================================================

/**
 * Updates an existing hut's details.
 * 
 * @param {string} hutId - The hut's ID
 * @param {string} userId - The user's ID (for authorization)
 * @param {Object} updates - The fields to update
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 * 
 * @example
 * const result = await updateHut(hutId, userId, {
 *   name: 'Updated Hut Name',
 *   availability: { ... }
 * });
 */
async function updateHut(hutId, userId, updates) {
    try {
        if (!hutId || !userId) {
            return { data: null, error: { message: 'Hut ID and User ID are required' } };
        }

        // Build update object (only include provided fields)
        const updateData = {};
        
        if (updates.name !== undefined) {
            updateData.name = updates.name.trim();
        }
        if (updates.slug !== undefined) {
            updateData.slug = updates.slug.toLowerCase().trim();
        }
        if (updates.address_line1 !== undefined) {
            updateData.address_line1 = updates.address_line1.trim();
        }
        if (updates.address_line2 !== undefined) {
            updateData.address_line2 = updates.address_line2 ? updates.address_line2.trim() : null;
        }
        if (updates.city !== undefined) {
            updateData.city = updates.city.trim();
        }
        if (updates.postcode !== undefined) {
            updateData.postcode = updates.postcode.trim().toUpperCase();
        }
        if (updates.availability !== undefined) {
            updateData.availability = updates.availability;
        }
        if (updates.weekly_sessions !== undefined) {
            updateData.weekly_sessions = updates.weekly_sessions;
        }

        // Update the hut (RLS will ensure user owns it)
        const { data, error } = await supabaseClient
            .from('scout_huts')
            .update(updateData)
            .eq('id', hutId)
            .eq('owner_id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating hut:', error);
            return { data: null, error };
        }

        return { data, error: null };

    } catch (err) {
        console.error('Unexpected error updating hut:', err);
        return { data: null, error: { message: 'An unexpected error occurred' } };
    }
}

// =============================================================================
// CHECK SLUG AVAILABILITY
// =============================================================================

/**
 * Checks if a slug is available (not already in use by another hut).
 * 
 * @param {string} slug - The slug to check
 * @param {string|null} excludeHutId - Optional hut ID to exclude (for updates)
 * @returns {Promise<{available: boolean, error: Object|null}>}
 * 
 * @example
 * const result = await checkSlugAvailability('my-scout-hut');
 * if (result.available) {
 *   console.log('Slug is available!');
 * }
 */
async function checkSlugAvailability(slug, excludeHutId = null) {
    try {
        if (!slug || slug.trim() === '') {
            return { available: false, error: { message: 'Slug is required' } };
        }

        // Normalize the slug
        const normalizedSlug = slug.toLowerCase().trim();

        // Check if slug exists
        let query = supabaseClient
            .from('scout_huts')
            .select('id')
            .eq('slug', normalizedSlug);

        // Exclude current hut if updating
        if (excludeHutId) {
            query = query.neq('id', excludeHutId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error checking slug availability:', error);
            return { available: false, error };
        }

        // Slug is available if no results found
        return { available: data.length === 0, error: null };

    } catch (err) {
        console.error('Unexpected error checking slug availability:', err);
        return { available: false, error: { message: 'An unexpected error occurred' } };
    }
}

// =============================================================================
// GET HUT BY SLUG (PUBLIC)
// =============================================================================

/**
 * Gets a hut by its URL slug.
 * This is used for public booking pages.
 * 
 * @param {string} slug - The hut's URL slug
 * @returns {Promise<Object|null>} The hut object or null if not found
 * 
 * @example
 * const hut = await getHutBySlug('1st-anytown-scout-hut');
 */
async function getHutBySlug(slug) {
    try {
        if (!slug) {
            return null;
        }

        const { data, error } = await supabaseClient
            .from('scout_huts')
            .select('*')
            .eq('slug', slug)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null;
            }
            console.error('Error fetching hut by slug:', error);
            return null;
        }

        return data;

    } catch (err) {
        console.error('Unexpected error fetching hut by slug:', err);
        return null;
    }
}

// =============================================================================
// FORMAT AVAILABILITY FOR DISPLAY
// =============================================================================

/**
 * Formats the availability schedule for display.
 * Returns an array of day/time objects for rendering.
 * 
 * @param {Object} availability - The availability object from the database
 * @returns {Array} Array of { day: string, times: string } objects
 * 
 * @example
 * formatAvailabilityDisplay(hut.availability)
 * // Returns: [{ day: 'Monday', times: '9am - 9pm' }, ...]
 */
function formatAvailabilityDisplay(availability) {
    if (!availability) {
        return [];
    }

    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = {
        monday: 'Monday',
        tuesday: 'Tuesday',
        wednesday: 'Wednesday',
        thursday: 'Thursday',
        friday: 'Friday',
        saturday: 'Saturday',
        sunday: 'Sunday'
    };

    const result = [];

    dayOrder.forEach(day => {
        const config = availability[day];
        if (config && config.enabled) {
            result.push({
                day: dayNames[day],
                times: `${formatTimeShort(config.start_time)} - ${formatTimeShort(config.end_time)}`
            });
        }
    });

    return result;
}

/**
 * Formats a time string (HH:MM) to short format (9am, 10pm, etc.)
 * @param {string} time - Time in HH:MM format
 * @returns {string} Formatted time
 */
function formatTimeShort(time) {
    if (!time) return '';
    
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    
    if (minutes === 0) {
        return `${hour12}${period}`;
    }
    return `${hour12}:${minutes.toString().padStart(2, '0')}${period}`;
}
