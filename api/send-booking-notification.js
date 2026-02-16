import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      ownerEmail,
      hutName,
      eventName,
      contactName,
      contactEmail,
      contactPhone,
      date,
      startTime,
      endTime,
      notes,
      bookingId
    } = req.body;

    // Validate required fields
    if (!ownerEmail || !hutName || !eventName || !contactName || !contactEmail || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format the date nicely
    const formattedDate = new Date(date).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Send email to hut owner
    const { data, error } = await resend.emails.send({
      from: 'Scout Bookings <notifications@scoutbookings.com>',
      to: ownerEmail,
      subject: `New Booking Request: ${eventName} at ${hutName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Booking Request</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); padding: 32px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">New Booking Request</h1>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 32px;">
                      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                        You have received a new booking request for <strong>${hutName}</strong> that requires your review.
                      </p>
                      
                      <!-- Booking Details Card -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                        <tr>
                          <td>
                            <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px; font-weight: 600;">${eventName}</h2>
                            
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Date</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${formattedDate}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Time</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${startTime} - ${endTime}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Contact Name</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${contactName}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Email</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${contactEmail}</span>
                                </td>
                              </tr>
                              ${contactPhone ? `
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Phone</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${contactPhone}</span>
                                </td>
                              </tr>
                              ` : ''}
                              ${notes ? `
                              <tr>
                                <td style="padding: 8px 0;">
                                  <span style="color: #6b7280; font-size: 14px;">Notes</span><br>
                                  <span style="color: #111827; font-size: 15px;">${notes}</span>
                                </td>
                              </tr>
                              ` : ''}
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center">
                            <a href="${process.env.APP_URL || 'https://scoutbookings.com'}/dashboard" 
                               style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                              Review Booking Request
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; color: #6b7280; font-size: 14px;">
                        This email was sent by Scout Bookings.<br>
                        You can manage your notification preferences in your <a href="${process.env.APP_URL || 'https://scoutbookings.com'}/settings" style="color: #7c3aed; text-decoration: none;">settings</a>.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Failed to send email', details: error.message });
    }

    return res.status(200).json({ success: true, messageId: data.id });
  } catch (error) {
    console.error('Error sending notification:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
