const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { protect } = require('../middleware/auth');

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  message: { message: 'Too many login attempts, please try again after 15 minutes' }
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many OTP requests, please try again later' }
});

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// --------------------------------------------------------
// ROUTE: SEND OTP (Pre-signup)
// --------------------------------------------------------
router.post('/send-otp', otpLimiter, [
  body('identifier').notEmpty().withMessage('Email or phone is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { identifier } = req.body;
    
    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email or phone' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

    // Upsert OTP
    await Otp.findOneAndUpdate(
      { identifier },
      { identifier, otpCode, expiresAt },
      { upsert: true, new: true }
    );

    console.log(`\n\n=== 📱 MOCK SMS/EMAIL ===\nTo: ${identifier}\nOTP: ${otpCode}\n=========================\n\n`);

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --------------------------------------------------------
// ROUTE: VERIFY OTP & SIGNUP
// --------------------------------------------------------
router.post('/verify-otp', otpLimiter, [
  body('identifier').notEmpty(),
  body('otpCode').isLength({ min: 6, max: 6 }),
  body('firstName').notEmpty(),
  body('lastName').notEmpty(),
  body('email').isEmail(),
  body('phone').notEmpty(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { identifier, otpCode, firstName, lastName, email, phone, password, role } = req.body;

    const otpRecord = await Otp.findOne({ identifier, otpCode });
    if (!otpRecord) return res.status(400).json({ message: 'Invalid OTP' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ message: 'OTP expired' });

    // Ensure user doesn't already exist
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      password,
      role,
      isVerified: true
    });

    // Delete OTP record
    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(201).json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      profilePicUrl: user.profilePicUrl,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --------------------------------------------------------
// ROUTE: LOGIN
// --------------------------------------------------------
router.post('/login', loginLimiter, [
  body('email').notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { email, password } = req.body;

    const user = await User.findOne({ 
      $or: [
        { email: email }, 
        { phone: email } 
      ]
    }).select('+password');

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profilePicUrl: user.profilePicUrl,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --------------------------------------------------------
// ROUTE: FORGOT PASSWORD
// --------------------------------------------------------
router.post('/forgot-password', [
  body('email').isEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const resetToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save({ validateBeforeSave: false });

    console.log(`\n\n=== 📧 MOCK EMAIL ===\nTo: ${user.email}\nSubject: Password Reset\nLink: http://localhost:5500/login_signup.html?reset=${resetToken}\n=====================\n\n`);

    res.json({ message: 'Password reset link sent to email' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --------------------------------------------------------
// ROUTE: RESET PASSWORD
// --------------------------------------------------------
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { token, password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    user.password = password; // Will be hashed by pre-save hook
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --------------------------------------------------------
// ROUTE: GET USER PROFILE (GET /api/auth/me OR /api/auth/profile)
// --------------------------------------------------------
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      res.json({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profilePicUrl: user.profilePicUrl,
        preferences: user.preferences
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

router.get('/profile', protect, getProfile);
router.get('/me', protect, getProfile); 

// --------------------------------------------------------
// ROUTE: UPDATE USER PROFILE (PUT /api/auth/profile)
// --------------------------------------------------------
router.put('/profile', protect, [
  body('firstName').optional().notEmpty(),
  body('lastName').optional().notEmpty(),
  body('phone').optional().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          phone: req.body.phone,
          ...(req.body.preferences && { preferences: req.body.preferences })
        }
      },
      { new: true, runValidators: true }
    );

    if (updatedUser) {
      res.json({
        _id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        profilePicUrl: updatedUser.profilePicUrl,
        preferences: updatedUser.preferences,
        token: generateToken(updatedUser._id)
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error("Backend update error:", error);
    res.status(500).json({ message: 'Server error: Could not update profile' });
  }
});

module.exports = router;