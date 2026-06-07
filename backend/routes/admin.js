const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Inquiry = require('../models/Inquiry');
const { deleteImageFile } = require('../utils/imageUtils');

// ──────────────────────────────────────────────
// ALL ADMIN ROUTES REQUIRE: protect + admin
// ──────────────────────────────────────────────

// GET /api/admin/listings — All listings on the platform
router.get('/listings', protect, admin, async (req, res) => {
  try {
    const listings = await Listing.find({}).populate('owner', 'firstName lastName email');
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching all listings' });
  }
});

// DELETE /api/admin/listings/:id — Force-delete any listing
router.delete('/listings/:id', protect, admin, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.images && listing.images.length > 0) listing.images.forEach(deleteImageFile);
    await listing.deleteOne();
    res.json({ message: 'Listing deleted by admin' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting listing' });
  }
});

// GET /api/admin/inquiries — All inquiries on the platform
router.get('/inquiries', protect, admin, async (req, res) => {
  try {
    const inquiries = await Inquiry.find({})
      .populate('sender', 'firstName lastName email')
      .populate('receiver', 'firstName lastName email')
      .populate('listing', 'title area city');
    res.json(inquiries);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching all inquiries' });
  }
});

// PUT /api/admin/inquiries/:id — Update inquiry status
router.put('/inquiries/:id', protect, admin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!inquiry) return res.status(404).json({ message: 'Inquiry not found' });
    res.json(inquiry);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating inquiry' });
  }
});

module.exports = router;
