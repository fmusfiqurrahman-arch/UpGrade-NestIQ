const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Otp = require('../models/Otp');
const BlacklistedToken = require('../models/BlacklistedToken');
const { protect } = require('../middleware/auth');

// ── COOKIE OPTIONS ────────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly: true,                                          // JS cannot read this cookie — blocks XSS token theft
  secure: process.env.COOKIE_SECURE === 'true',           // HTTPS only in production
  sameSite: process.env.COOKIE_SECURE === 'true' ? 'strict' : 'lax', // CSRF protection
  maxAge: 30 * 24 * 60 * 60 * 1000,                       // 30 days in milliseconds
  path: '/',
};

// ── TOKEN GENERATOR ───────────────────────────────────────────
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// ── HELPER: Set auth cookie + return user payload ─────────────
const sendTokenResponse = (user, res) => {
  const token = generateToken(user._id);
  res.cookie('nestiq_token', token, COOKIE_OPTIONS);

  // Return user data WITHOUT the token in the body
  // The token lives exclusively in the httpOnly cookie
  res.json({
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    profilePicUrl: user.profilePicUrl,
    isVerified: user.isVerified,
    // No 'token' field here — it's in the httpOnly cookie
  });
};

// ── NODEMAILER TRANSPORT ──────────────────────────────────────
// Uses Gmail via App Password (nodemailer already installed)
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Helper to send emails — logs to console if email not configured
const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER.includes('YOUR_GMAIL')) {
    // Not configured yet — log to console (dev mode)
    console.log(`\n\n=== 📧 EMAIL (Dev Mode - Not Sent) ===\nTo: ${to}\nSubject: ${subject}\n======================================\n\n`);
    return;
  }
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"NestIQ" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

// ── RATE LIMITERS ─────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: { message: 'Too many login attempts. Please try again after 15 minutes.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: { message: 'Too many OTP requests. Please try again later.' },
});

// ── ROUTE: SEND OTP (Pre-signup) ──────────────────────────────
router.post('/send-otp', otpLimiter, [
  body('identifier').notEmpty().withMessage('Email or phone is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { identifier } = req.body;
    
    const userExists = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email or phone.' });
    }

    // FIX: Use crypto.randomInt — cryptographically secure, unlike Math.random()
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

    await Otp.findOneAndUpdate(
      { identifier },
      { identifier, otpCode, expiresAt },
      { upsert: true, new: true }
    );

    // Try to send real email/SMS — falls back to console in dev
    await sendEmail({
      to: identifier,
      subject: 'Your NestIQ Verification Code',
      html: `
        <div style="font-family: 'DM Sans', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; background: #f7f4ef; border-radius: 8px;">
          <h1 style="font-family: Georgia, serif; font-size: 32px; font-weight: 300; color: #0f0e0c; margin-bottom: 8px;">
            NestIQ
          </h1>
          <p style="font-size: 14px; color: #8a8680; margin-bottom: 32px;">Smart Real Estate Platform</p>
          <h2 style="font-size: 18px; font-weight: 500; color: #0f0e0c; margin-bottom: 16px;">Your Verification Code</h2>
          <div style="background: #0f0e0c; color: #f7f4ef; padding: 24px; border-radius: 4px; text-align: center; margin-bottom: 24px;">
            <span style="font-family: Georgia, serif; font-size: 42px; letter-spacing: 12px; color: #bc9556;">${otpCode}</span>
          </div>
          <p style="font-size: 13px; color: #8a8680; line-height: 1.7;">
            This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
          </p>
        </div>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`📱 OTP for ${identifier}: ${otpCode}`);
    }
    res.json({ message: 'OTP sent successfully.' });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
  }
});

// ── ROUTE: VERIFY OTP & SIGNUP ────────────────────────────────
router.post('/verify-otp', otpLimiter, [
  body('identifier').notEmpty(),
  body('otpCode').isLength({ min: 6, max: 6 }),
  body('firstName').notEmpty().trim().escape(),
  body('lastName').notEmpty().trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty(),
  body('password').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { identifier, otpCode, firstName, lastName, email, phone, password, role } = req.body;

    const otpRecord = await Otp.findOne({ identifier, otpCode });
    if (!otpRecord) return res.status(400).json({ message: 'Invalid OTP code.' });
    if (otpRecord.expiresAt < new Date()) return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'An account with this email already exists.' });

    const phoneExists = await User.findOne({ phone });
    if (phoneExists) return res.status(400).json({ message: 'An account with this phone number already exists.' });

    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      password,
      role: ['tenant', 'owner'].includes(role) ? role : 'tenant',
      isVerified: true,
    });

    await Otp.deleteOne({ _id: otpRecord._id });

    // Send welcome email
    await sendEmail({
      to: email,
      subject: 'Welcome to NestIQ! 🏠',
      html: `
        <div style="font-family: 'DM Sans', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; background: #f7f4ef;">
          <h1 style="font-family: Georgia, serif; font-weight: 300; color: #0f0e0c;">Welcome, ${firstName}!</h1>
          <p style="color: #8a8680; line-height: 1.7;">Your NestIQ account has been created successfully. Start exploring verified listings and find your perfect home.</p>
          <a href="${process.env.BASE_URL || 'http://localhost:5500'}/listings.html" 
             style="display: inline-block; background: #bc9556; color: #f7f4ef; padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 24px;">
            Browse Listings
          </a>
        </div>
      `,
    });

    // Set httpOnly cookie and return user (no token in body)
    sendTokenResponse(user, res);
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ message: 'Signup failed. Please try again.' });
  }
});

// ── ROUTE: LOGIN ──────────────────────────────────────────────
router.post('/login', loginLimiter, [
  body('email').notEmpty().withMessage('Email or phone is required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      $or: [{ email }, { phone: email }],
    }).select('+password');

    if (user && (await user.matchPassword(password))) {
      // Set httpOnly cookie and return user (no token in body)
      sendTokenResponse(user, res);
    } else {
      res.status(401).json({ message: 'Invalid email or password.' });
    }
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

// ── ROUTE: LOGOUT ──────────────────────────────────────────────
// Clears the httpOnly cookie and blacklists the token so it can't be reused
router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies.nestiq_token;

  if (token) {
    try {
      const decoded = require('jsonwebtoken').decode(token);
      if (decoded && decoded.exp) {
        await BlacklistedToken.create({
          token,
          expiresAt: new Date(decoded.exp * 1000),
        });
      }
    } catch (_) {
      // Malformed token — safe to ignore, just clear the cookie
    }
  }

  res.cookie('nestiq_token', '', {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SECURE === 'true' ? 'strict' : 'lax',
    expires: new Date(0),
    path: '/',
  });
  res.json({ message: 'Logged out successfully.' });
});

// ── ROUTE: FORGOT PASSWORD ─────────────────────────────────────
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // FIX: Always return 200 — never reveal if email exists (prevents user enumeration)
  const genericResponse = { message: 'If that email is registered, a reset link has been sent.' };

  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      // Don't reveal that the user wasn't found
      return res.json(genericResponse);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    // Store only the hash — the raw token lives only in the email link
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5500'}/login_signup.html?reset=${resetToken}`;

    await sendEmail({
      to: user.email,
      subject: 'NestIQ Password Reset Request',
      html: `
        <div style="font-family: 'DM Sans', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; background: #f7f4ef;">
          <h1 style="font-family: Georgia, serif; font-weight: 300; color: #0f0e0c;">Reset Your Password</h1>
          <p style="color: #8a8680; line-height: 1.7;">We received a request to reset the password for your NestIQ account.</p>
          <p style="color: #8a8680; line-height: 1.7;">Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" 
             style="display: inline-block; background: #0f0e0c; color: #f7f4ef; padding: 14px 32px; border-radius: 4px; text-decoration: none; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 24px;">
            Reset Password
          </a>
          <p style="color: #8a8680; font-size: 12px; margin-top: 24px;">
            If you didn't request this, you can safely ignore this email. Your password will not change.
          </p>
        </div>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n📧 Password reset link for ${user.email}:\n${resetUrl}\n`);
    }
    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.json(genericResponse); // Still don't reveal errors to the client
  }
});

// ── ROUTE: RESET PASSWORD ─────────────────────────────────────
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { token, password } = req.body;
    // Hash the incoming token to compare against the stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'Reset link is invalid or has expired.' });

    user.password = password; // Pre-save hook hashes this
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ── ROUTE: GET PROFILE ────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      profilePicUrl: user.profilePicUrl,
      isVerified: user.isVerified,
      preferences: user.preferences,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

router.get('/profile', protect, getProfile);
router.get('/me', protect, getProfile);

// ── ROUTE: UPDATE PROFILE ──────────────────────────────────────
router.put('/profile', protect, [
  body('firstName').optional().notEmpty().trim().escape(),
  body('lastName').optional().notEmpty().trim().escape(),
  body('phone').optional().notEmpty(),
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
          ...(req.body.preferences && { preferences: req.body.preferences }),
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    res.json({
      _id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      profilePicUrl: updatedUser.profilePicUrl,
      isVerified: updatedUser.isVerified,
      preferences: updatedUser.preferences,
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(500).json({ message: 'Server error: Could not update profile.' });
  }
});

// ── ROUTE: CONFIG (Google Client ID for frontend) ──────────────
router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// ── HELPERS: Verify Google token ──────────────────────────────
async function verifyGoogleToken(credential) {
  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (e) {
    return null;
  }
}

// ── ROUTE: GOOGLE OAUTH ────────────────────────────────────────
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ message: 'Missing Google credential' });

  const payload = await verifyGoogleToken(credential);
  if (!payload) return res.status(401).json({ message: 'Invalid or expired Google token.' });

  const {
    sub: googleId,
    email,
    given_name: firstName,
    family_name: lastName,
    picture: profilePicUrl,
  } = payload;

  if (!email) return res.status(400).json({ message: 'Google account has no email.' });

  try {
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (!user) {
      user = await User.create({
        googleId,
        firstName: firstName || 'Google',
        lastName: lastName || 'User',
        email,
        phone: '',
        profilePicUrl: profilePicUrl || '',
        isVerified: true,
        role: 'tenant',
      });
    } else {
      let changed = false;
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (profilePicUrl && !user.profilePicUrl) { user.profilePicUrl = profilePicUrl; changed = true; }
      if (changed) await user.save({ validateBeforeSave: false });
    }

    // Set httpOnly cookie and return user
    sendTokenResponse(user, res);
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(500).json({ message: 'Server error during Google authentication.' });
  }
});

module.exports = router;