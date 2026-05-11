const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS   // Gmail App Password (not your regular password)
  }
});

// ── Send email to property owner when someone messages about their listing ──
async function sendOwnerInquiryEmail({ ownerEmail, ownerName, senderName, senderPhone, senderEmail, listingTitle, message, subject }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  await transporter.sendMail({
    from: `"NestIQ" <${process.env.EMAIL_USER}>`,
    to: ownerEmail,
    subject: `New enquiry on your listing: ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e8e3da;border-radius:4px">
        <h2 style="color:#b89b6a;font-family:Georgia,serif;margin-bottom:4px">New Enquiry</h2>
        <p style="color:#666;font-size:14px;margin-top:0">Someone is interested in your listing on NestIQ.</p>
        <hr style="border:none;border-top:1px solid #e8e3da;margin:20px 0"/>
        <p style="font-size:15px"><strong>Listing:</strong> ${listingTitle}</p>
        <p style="font-size:15px"><strong>Subject:</strong> ${subject || 'Property Enquiry'}</p>
        <p style="font-size:15px"><strong>From:</strong> ${senderName}</p>
        ${senderPhone ? `<p style="font-size:15px"><strong>Phone:</strong> ${senderPhone}</p>` : ''}
        ${senderEmail ? `<p style="font-size:15px"><strong>Email:</strong> ${senderEmail}</p>` : ''}
        <div style="background:#f7f4ef;border-left:3px solid #b89b6a;padding:16px;margin:20px 0;border-radius:2px">
          <p style="margin:0;font-size:15px;color:#333">${message}</p>
        </div>
        <p style="font-size:13px;color:#999;margin-top:24px">Reply directly to this email or contact them via the details above.</p>
        <p style="font-size:12px;color:#bbb">— NestIQ Team</p>
      </div>
    `
  });
}

// ── Send confirmation to the person who sent the message ──
async function sendEnquiryConfirmationEmail({ toEmail, toName, listingTitle }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !toEmail) return;
  await transporter.sendMail({
    from: `"NestIQ" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `Your enquiry has been received — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e8e3da;border-radius:4px">
        <h2 style="color:#b89b6a;font-family:Georgia,serif">Message Received</h2>
        <p style="font-size:15px">Hi ${toName},</p>
        <p style="font-size:15px">We've forwarded your enquiry about <strong>${listingTitle}</strong> to the property owner. They'll be in touch with you shortly.</p>
        <p style="font-size:13px;color:#999;margin-top:24px">If you have any questions, reply to this email or visit <a href="https://nestiq.com" style="color:#b89b6a">nestiq.com</a>.</p>
        <p style="font-size:12px;color:#bbb">— NestIQ Team</p>
      </div>
    `
  });
}

// ── Send contact form message to NestIQ admin ──
async function sendContactFormEmail({ senderName, senderEmail, senderPhone, subject, message }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  await transporter.sendMail({
    from: `"NestIQ Contact Form" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    replyTo: senderEmail || process.env.EMAIL_USER,
    subject: `[NestIQ Contact] ${subject || 'New Message'}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e8e3da;border-radius:4px">
        <h2 style="color:#b89b6a;font-family:Georgia,serif;margin-bottom:4px">Contact Form Submission</h2>
        <p style="color:#666;font-size:14px;margin-top:0">Someone sent a message via the About page.</p>
        <hr style="border:none;border-top:1px solid #e8e3da;margin:20px 0"/>
        <p style="font-size:15px"><strong>Name:</strong> ${senderName}</p>
        ${senderEmail ? `<p style="font-size:15px"><strong>Email:</strong> ${senderEmail}</p>` : ''}
        ${senderPhone ? `<p style="font-size:15px"><strong>Phone:</strong> ${senderPhone}</p>` : ''}
        <p style="font-size:15px"><strong>Subject:</strong> ${subject || '—'}</p>
        <div style="background:#f7f4ef;border-left:3px solid #b89b6a;padding:16px;margin:20px 0;border-radius:2px">
          <p style="margin:0;font-size:15px;color:#333">${message}</p>
        </div>
        <p style="font-size:12px;color:#bbb">— NestIQ Platform</p>
      </div>
    `
  });
}

// ── Send confirmation to the contact form submitter ──
async function sendContactFormConfirmationEmail({ toEmail, toName }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !toEmail) return;
  await transporter.sendMail({
    from: `"NestIQ" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'We received your message — NestIQ',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e8e3da;border-radius:4px">
        <h2 style="color:#b89b6a;font-family:Georgia,serif">Thanks for reaching out!</h2>
        <p style="font-size:15px">Hi ${toName},</p>
        <p style="font-size:15px">We've received your message and our team will get back to you within 2 hours.</p>
        <p style="font-size:13px;color:#999;margin-top:24px">— NestIQ Team</p>
      </div>
    `
  });
}

module.exports = {
  sendOwnerInquiryEmail,
  sendEnquiryConfirmationEmail,
  sendContactFormEmail,
  sendContactFormConfirmationEmail
};
