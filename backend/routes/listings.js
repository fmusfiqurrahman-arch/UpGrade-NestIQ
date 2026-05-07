const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing'); 
const { protect, admin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

// ── THE SMART IMAGE JANITOR ──────────────────────────────────
// This helper physically deletes image files from the server
const deleteImageFile = (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('/uploads/')) return;
  
  const filename = imageUrl.split('/uploads/')[1];
  if (filename) {
    const filepath = path.join(__dirname, '../uploads', filename);
    fs.unlink(filepath, (err) => {
      if (err) console.error("Janitor Failed to delete:", filepath, err.message);
      else console.log("Janitor successfully cleaned up:", filename);
    });
  }
};

// 1. GET ALL LISTINGS
router.get('/', async (req, res) => {
  try {
    const listings = await Listing.find({});
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: 'Server Error: Could not fetch listings' });
  }
});

// 2. GET MY LISTINGS
router.get('/me', protect, async (req, res) => {
  try {
    const myProperties = await Listing.find({ owner: req.user._id });
    res.json(myProperties);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch your properties' });
  }
});

// 3. GET A SINGLE LISTING
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (listing) {
      res.json(listing);
    } else {
      res.status(404).json({ message: 'Listing not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// 4. CREATE A LISTING
router.post('/', protect, async (req, res) => {
  try {
    const listingData = req.body;
    listingData.owner = req.user._id; 
    const newListing = await Listing.create(listingData);
    res.status(201).json(newListing);
  } catch (error) {
    res.status(400).json({ message: 'Failed to create listing: ' + error.message });
  }
});

// 5. UPDATE A LISTING (Includes Smart Janitor)
router.put('/:id', protect, async (req, res) => {
  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // Security Check: Must be the Owner OR an Admin
    if (listing.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access Denied: You cannot edit this property' });
    }

    // Janitor: If the user updated the images array, delete the photos they removed
    if (req.body.images && Array.isArray(req.body.images)) {
      const newImages = req.body.images;
      const oldImages = listing.images || [];
      // Find images that are in the old array but missing from the new array
      const deletedImages = oldImages.filter(img => !newImages.includes(img));
      
      deletedImages.forEach(deleteImageFile);
    }

    listing = await Listing.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update property' });
  }
});

// 6. DELETE A LISTING (The Ultimate Janitor)
router.delete('/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    // Security Check: Must be the Owner OR an Admin
    if (listing.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access Denied: You cannot delete this property' });
    }

    // Janitor: Delete ALL photos associated with this listing from the server!
    if (listing.images && listing.images.length > 0) {
      listing.images.forEach(deleteImageFile);
    }

    await listing.deleteOne();
    res.json({ message: 'Listing and all associated photos were successfully deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error during deletion' });
  }
});

module.exports = router;