const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Inquiry = require('../models/Inquiry');
const Listing = require('../models/Listing');
const { protect } = require('../middleware/auth');
const {
  sendOwnerInquiryEmail,
  sendEnquiryConfirmationEmail,
  sendContactFormEmail,
  sendContactFormConfirmationEmail
} = require('../utils/email');

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const decodeOptionalToken = async (req, res, next) => {
  let token;
  if (req.cookies && req.cookies.nestiq_token) {
    token = req.cookies.nestiq_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Invalid token — treat as guest, don't block the request
    }
  }
  next();
};

const inquiryValidation = [
  body('type').isIn(['message', 'booking', 'contact']),
  body('content').notEmpty().trim().isLength({ max: 2000 }),
  body('senderName').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('senderEmail').optional({ checkFalsy: true }).trim().isEmail().normalizeEmail().isLength({ max: 254 }),
  body('senderPhone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('subject').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
];

// --------------------------------------------------------
// CREATE INQUIRY (Open to guests for 'match', protected otherwise if needed)
// --------------------------------------------------------
router.post('/', decodeOptionalToken, inquiryValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }

  try {
    const { receiver, listing, type, content, senderName, senderEmail, senderPhone, subject } = req.body;
    const senderId = req.user ? req.user._id : null;

    const resolvedSenderName  = senderName  || (req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : '');
    const resolvedSenderEmail = senderEmail || (req.user ? req.user.email : '');
    const resolvedSenderPhone = senderPhone || (req.user ? req.user.phone : '');

    const inquiry = await Inquiry.create({
      sender:      senderId,
      receiver:    receiver || null,
      listing:     listing  || null,
      type,
      content,
      senderName:  resolvedSenderName,
      senderEmail: resolvedSenderEmail,
      senderPhone: resolvedSenderPhone,
      subject:     subject  || ''
    });

    // ── Fire emails (non-blocking — don't let email failure kill the response) ──
    setImmediate(async () => {
      try {
        if (type === 'contact') {
          // About page contact form → email NestIQ admin
          await sendContactFormEmail({
            senderName:  resolvedSenderName,
            senderEmail: resolvedSenderEmail,
            senderPhone: resolvedSenderPhone,
            subject,
            message: content
          });
          await sendContactFormConfirmationEmail({
            toEmail: resolvedSenderEmail,
            toName:  resolvedSenderName
          });

        } else if ((type === 'message' || type === 'booking') && listing) {
          // Listing enquiry → email the property owner
          const listingDoc = await Listing.findById(listing).populate('owner', 'firstName lastName email');
          if (listingDoc && listingDoc.owner && listingDoc.owner.email) {
            const owner = listingDoc.owner;
            await sendOwnerInquiryEmail({
              ownerEmail:  owner.email,
              ownerName:   `${owner.firstName} ${owner.lastName}`.trim(),
              senderName:  resolvedSenderName,
              senderPhone: resolvedSenderPhone,
              senderEmail: resolvedSenderEmail,
              listingTitle: listingDoc.title,
              message:      content,
              subject:      subject || (type === 'booking' ? 'Viewing Request' : 'Property Enquiry')
            });
            // Send confirmation to the person who enquired
            await sendEnquiryConfirmationEmail({
              toEmail:      resolvedSenderEmail,
              toName:       resolvedSenderName,
              listingTitle: listingDoc.title
            });
          }
        }
      } catch (emailErr) {
        console.error('Email send error:', emailErr.message);
      }
    });

    res.status(201).json(inquiry);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --------------------------------------------------------
// GET INQUIRIES (Protected)
// --------------------------------------------------------
router.get('/', protect, async (req, res) => {
  try {
    let inquiries;
    if (req.user.role === 'admin') {
      inquiries = await Inquiry.find({}).populate('sender', 'firstName lastName email phone').populate('listing', 'title location');
    } else if (req.user.role === 'owner') {
      inquiries = await Inquiry.find({ receiver: req.user._id }).populate('sender', 'firstName lastName email phone').populate('listing', 'title location');
    } else {
      // Tenant
      inquiries = await Inquiry.find({ sender: req.user._id }).populate('receiver', 'firstName lastName email phone').populate('listing', 'title location');
    }

    res.json(inquiries);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
