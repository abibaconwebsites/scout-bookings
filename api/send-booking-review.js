import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      recipientEmail,
      recipientName,
      hutName,
      eventName,
      date,
      startTime,
      endTime,
      status, // 'approved' or 'declined'
      bookingUrl // Optional: URL to view the booking
    } = req.body;

    // Validate required fields
    if (!recipientEmail || !recipientName || !hutName || !eventName || !date || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate status
    if (!['approved', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "approved" or "declined"' });
    }

    // Format the date nicely
    const formattedDate = new Date(date).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const isApproved = status === 'approved';
    const statusColor = isApproved ? '#16a34a' : '#dc2626';
    const statusBgColor = isApproved ? '#dcfce7' : '#fee2e2';
    const statusText = isApproved ? 'Approved' : 'Declined';
    const headerGradient = isApproved 
      ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
      : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)';

    // Send email to the person who requested the booking
    const { data, error } = await resend.emails.send({
      from: 'Scout Bookings <notifications@scoutbookings.com>',
      to: recipientEmail,
      subject: `Booking ${statusText}: ${eventName} at ${hutName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Booking ${statusText}</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <!-- Header -->
                  <tr>
                    <td style="background: ${headerGradient}; padding: 32px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Booking ${statusText}</h1>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 32px;">
                      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                        Hi ${recipientName},
                      </p>
                      
                      ${isApproved ? `
                      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                        Great news! Your booking request for <strong>${hutName}</strong> has been <strong style="color: ${statusColor};">approved</strong>.
                      </p>
                      ` : `
                      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                        Unfortunately, your booking request for <strong>${hutName}</strong> has been <strong style="color: ${statusColor};">declined</strong>.
                      </p>
                      <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                        This may be due to a scheduling conflict or other reasons. Please feel free to submit a new request for a different date or contact the hut owner directly.
                      </p>
                      `}
                      
                      <!-- Status Badge -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <tr>
                          <td align="center">
                            <span style="display: inline-block; background-color: ${statusBgColor}; color: ${statusColor}; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                              ${statusText.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Booking Details Card -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                        <tr>
                          <td>
                            <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px; font-weight: 600;">${eventName}</h2>
                            
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Venue</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${hutName}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
                                  <span style="color: #6b7280; font-size: 14px;">Date</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${formattedDate}</span>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0;">
                                  <span style="color: #6b7280; font-size: 14px;">Time</span><br>
                                  <span style="color: #111827; font-size: 15px; font-weight: 500;">${startTime} - ${endTime}</span>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      ${isApproved ? `
                      <!-- Confirmation Message -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #dcfce7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                        <tr>
                          <td style="color: #166534; font-size: 14px; line-height: 1.5;">
                            <strong>What's next?</strong><br>
                            Your booking is now confirmed. Please arrive on time and follow any venue guidelines. If you need to make changes or cancel, please contact the hut owner.
                          </td>
                        </tr>
                      </table>
                      ` : `
                      <!-- Alternative Action -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center">
                            <a href="${bookingUrl || (process.env.APP_URL || 'https://scoutbookings.com')}" 
                               style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                              Book Another Date
                            </a>
                          </td>
                        </tr>
                      </table>
                      `}
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; color: #6b7280; font-size: 14px;">
                        This email was sent by Scout Bookings on behalf of ${hutName}.
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
