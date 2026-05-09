const express = require('express');
const router = express.Router();
const Inquiry = require('../models/Inquiry');
const { protect } = require('../middleware/auth');

// Optional protect middleware (doesn't throw error if no token, just sets req.user if present)
const optionalProtect = require('jsonwebtoken');
const User = require('../models/User');

const decodeOptionalToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = optionalProtect.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      console.error(error);
    }
  }
  next();
};

// --------------------------------------------------------
// CREATE INQUIRY (Open to guests for 'match', protected otherwise if needed)
// --------------------------------------------------------
router.post('/', decodeOptionalToken, async (req, res) => {
  try {
    const { receiver, listing, type, content } = req.body;
    
    // If not logged in, only allow 'match' (or we can allow all as guest leads)
    const senderId = req.user ? req.user._id : null;

    const inquiry = await Inquiry.create({
      sender: senderId,
      receiver: receiver || null,
      listing: listing || null,
      type,
      content
    });

    res.status(201).json(inquiry);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
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
