const express = require('express');
const router = express.Router();
const User = require('../models/User');
const SavedListing = require('../models/SavedListing');
const Activity = require('../models/Activity');
const { protect, admin } = require('../middleware/auth');
const upload = require('../utils/upload');
const path = require('path');
const fs = require('fs');

// ── THE INDESTRUCTIBLE FILE JANITOR ──────────────────────────
const deleteFile = (fileUrl) => {
  try {
    // 1. If it is null, undefined, or totally empty, stop immediately.
    if (!fileUrl) return; 
    
    // 2. Force whatever Mongoose gave us into a pure string format
    const urlString = String(fileUrl); 
    
    // 3. Proceed only if it contains our uploads path
    if (urlString.includes('/uploads/')) {
      const filename = urlString.split('/uploads/')[1];
      
      if (filename) {
        const filepath = path.join(__dirname, '../uploads', filename);
        
        // 4. Actually check if the file exists on the hard drive before deleting!
        if (fs.existsSync(filepath)) {
          fs.unlink(filepath, (err) => { 
            if (err) console.error("Janitor warning (ignored):", err.message); 
          });
        }
      }
    }
  } catch (error) {
    // 5. If anything bizarre happens, log it but DO NOT crash the server
    console.error("Janitor caught a ghost file, but server remains stable.");
  }
};

// -----------------------------------------------------------------
// 1. UPLOAD PROFILE PICTURE 
// -----------------------------------------------------------------
router.post('/profile-pic', protect, (req, res) => {
  upload.single('profilePic')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: 'Upload rejected: ' + err.message });
    if (!req.file) return res.status(400).json({ message: 'No image file received.' });

    try {
      // 1. Find user to get the OLD picture for the Janitor
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      // 2. Run the Janitor to delete the old picture
      deleteFile(user.profilePicUrl);

      // 3. Create the clean, URL-safe image link
      const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
      const newPicUrl = `${baseUrl}/uploads/${req.file.filename}`;

      // 4. SURGICAL UPDATE: Update ONLY the profile picture to bypass strict validation!
      await User.findByIdAndUpdate(
        req.user._id,
        { $set: { profilePicUrl: newPicUrl } },
        { new: true, runValidators: false } 
      );
      
      res.json({ message: 'Profile picture updated', profilePicUrl: newPicUrl });
    } catch (error) {
      console.error("Upload Error:", error);
      res.status(500).json({ message: 'Database error saving profile picture' });
    }
  });
});

// -----------------------------------------------------------------
// 2. UPLOAD NID / PASSPORT (With Surgical Update)
// -----------------------------------------------------------------
router.post('/nid-upload', protect, (req, res) => {
  upload.single('nidDoc')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: 'Upload rejected: ' + err.message });
    if (!req.file) return res.status(400).json({ message: 'No document uploaded' });

    try {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      // Janitor cleans old NID
      deleteFile(user.nidDocUrl);

      const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
      const newNidUrl = `${baseUrl}/uploads/${req.file.filename}`;

      // SURGICAL UPDATE: Bypass strict validation!
      await User.findByIdAndUpdate(
        req.user._id,
        { $set: { nidDocUrl: newNidUrl, isVerified: false } },
        { new: true, runValidators: false }
      );

      setImmediate(() => Activity.create({
        user: req.user._id,
        type: 'nid_uploaded',
        description: 'You uploaded your NID/Passport for identity verification.',
        meta: {}
      }).catch(() => {}));

      res.json({ message: 'NID uploaded successfully. Awaiting Admin verification.', nidDocUrl: newNidUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error uploading NID' });
    }
  });
});

// -----------------------------------------------------------------
// 3. ADMIN ONLY: GET ALL USERS
// -----------------------------------------------------------------
router.get('/admin/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// -----------------------------------------------------------------
// 4. ADMIN ONLY: TOGGLE VERIFICATION STATUS
// -----------------------------------------------------------------
router.put('/admin/users/:id/verify', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isVerified = !user.isVerified; 
    await user.save();

    res.json({ message: `User is now ${user.isVerified ? 'Verified' : 'Unverified'}`, isVerified: user.isVerified });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating verification' });
  }
});

// -----------------------------------------------------------------
// 4.5 ADMIN ONLY: EDIT USER ROLE
// -----------------------------------------------------------------
router.put('/admin/users/:id/role', protect, admin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['tenant', 'owner', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.role = role;
    await user.save();

    res.json({ message: `User role updated to ${role}`, role: user.role });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating role' });
  }
});

// -----------------------------------------------------------------
// 4.6 ADMIN ONLY: PLATFORM STATS
// -----------------------------------------------------------------
router.get('/admin/stats', protect, admin, async (req, res) => {
  try {
    const Listing = require('../models/Listing');
    const Inquiry = require('../models/Inquiry');
    
    const [usersCount, verifiedUsers, totalListings, totalInquiries] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      Listing.countDocuments({ status: 'approved' }),
      Inquiry.countDocuments()
    ]);

    res.json({
      usersCount,
      verifiedUsers,
      totalListings,
      totalInquiries
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching admin stats' });
  }
});

// -----------------------------------------------------------------
// 5. SAVED LISTINGS (WISHLIST)
// -----------------------------------------------------------------
router.get('/saved-listings', protect, async (req, res) => {
  try {
    const saved = await SavedListing.find({ user: req.user._id }).populate('listing');
    res.json(saved.map(s => s.listing).filter(Boolean));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching saved listings' });
  }
});

router.post('/saved-listings', protect, async (req, res) => {
  try {
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ message: 'Listing ID is required' });

    // Check if already saved
    const exists = await SavedListing.findOne({ user: req.user._id, listing: listingId });
    if (exists) return res.json({ message: 'Already saved', saved: true });

    const saved = await SavedListing.create({ user: req.user._id, listing: listingId });
    setImmediate(async () => {
      try {
        const Listing = require('../models/Listing');
        const l = await Listing.findById(listingId).select('title').lean();
        await Activity.create({
          user: req.user._id,
          type: 'listing_saved',
          description: `You saved "${l ? l.title : 'a property'}" to your wishlist.`,
          meta: { listingId }
        });
      } catch (_) {}
    });
    res.status(201).json({ message: 'Listing saved', saved: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error saving listing' });
  }
});

router.delete('/saved-listings/:id', protect, async (req, res) => {
  try {
    await SavedListing.findOneAndDelete({ user: req.user._id, listing: req.params.id });
    setImmediate(async () => {
      try {
        const Listing = require('../models/Listing');
        const l = await Listing.findById(req.params.id).select('title').lean();
        await Activity.create({
          user: req.user._id,
          type: 'listing_unsaved',
          description: `You removed "${l ? l.title : 'a property'}" from your wishlist.`,
          meta: { listingId: req.params.id }
        });
      } catch (_) {}
    });
    res.json({ message: 'Listing removed from saved', saved: false });
  } catch (error) {
    res.status(500).json({ message: 'Error removing saved listing' });
  }
});

// Bulk clear all saved listings
router.delete('/saved-listings', protect, async (req, res) => {
  try {
    await SavedListing.deleteMany({ user: req.user._id });
    res.json({ message: 'All saved listings cleared' });
  } catch (error) {
    res.status(500).json({ message: 'Error clearing saved listings' });
  }
});

module.exports = router;