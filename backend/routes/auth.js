const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Standardized capitalization
const { protect } = require('../middleware/auth');

// Helper function to create the VIP Pass (Token)
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// --------------------------------------------------------
// ROUTE 1: SIGN UP (POST /api/auth/signup)
// --------------------------------------------------------
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, role } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create the new user
    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      password,
      role
    });

    // Send back success and token
    if (user) {
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
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --------------------------------------------------------
// ROUTE 2: LOGIN (POST /api/auth/login)
// --------------------------------------------------------
router.post('/login', async (req, res) => {
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
// ROUTE 3: GET USER PROFILE (GET /api/auth/me OR /api/auth/profile)
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
        profilePicUrl: user.profilePicUrl
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Hook up both endpoints so the frontend never gets confused!
router.get('/profile', protect, getProfile);
router.get('/me', protect, getProfile); 

// --------------------------------------------------------
// ROUTE 4: UPDATE USER PROFILE (PUT /api/auth/profile)
// --------------------------------------------------------
router.put('/profile', protect, async (req, res) => {
  try {
    // Use findByIdAndUpdate to cleanly bypass strict .save() validation rules
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          phone: req.body.phone
        }
      },
      { new: true } // This tells Mongoose to return the freshly updated data!
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
        token: generateToken(updatedUser._id) // Give them a fresh token!
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