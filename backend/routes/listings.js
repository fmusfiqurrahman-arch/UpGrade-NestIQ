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

// 0. GET PLATFORM STATS
router.get('/stats', async (req, res) => {
  try {
    const totalListings = await Listing.countDocuments();
    const forRent = await Listing.countDocuments({ propertyType: 'rent' });
    const forSale = await Listing.countDocuments({ propertyType: 'sale' });
    
    const avgPriceResult = await Listing.aggregate([
      { $group: { _id: null, avgPrice: { $avg: "$price" } } }
    ]);
    const avgPrice = avgPriceResult.length > 0 ? Math.round(avgPriceResult[0].avgPrice) : 0;
    
    // Hardcode user counts or fetch from User model if required. We'll fetch.
    const User = require('../models/User');
    const usersCount = await User.countDocuments();
    const verifiedUsers = await User.countDocuments({ isVerified: true });

    res.json({
      totalListings,
      forRent,
      forSale,
      avgPrice,
      usersCount,
      verifiedUsers
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error: Could not fetch stats' });
  }
});

// 1. GET ALL LISTINGS
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit) || 12;
    
    const filter = {};
    if (req.query.type) filter.propertyType = req.query.type;
    
    if (page) {
      const skip = (page - 1) * limit;
      const total = await Listing.countDocuments(filter);
      const listings = await Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
      res.json({
        listings,
        page,
        totalPages: Math.ceil(total / limit),
        totalListings: total
      });
    } else {
      // Backwards compatible logic
      const listings = await Listing.find(filter).sort({ createdAt: -1 });
      res.json(listings);
    }
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

// 2.5 GET AI MATCHES
router.get('/matches', protect, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    const prefs = user.preferences || {};
    
    const listings = await Listing.find().lean();
    
    const scoredListings = listings.map(p => {
      let score = 50; // Base score
      
      // Intent Match
      const pIntent = p.propertyType === 'sale' ? 'buy' : 'rent';
      if (prefs.intent && prefs.intent !== 'any') {
        if (pIntent === prefs.intent) score += 20;
      } else {
        score += 10;
      }
      
      // Location Match
      if (prefs.location && p.location) {
        if (p.location.toLowerCase().includes(prefs.location.toLowerCase())) {
          score += 15;
        }
      }
      
      // Budget Match
      if (prefs.maxPrice && prefs.maxPrice > 0 && p.price) {
        if (p.price <= prefs.maxPrice) {
          score += 10;
        } else if (p.price <= prefs.maxPrice * 1.2) {
          score += 5;
        }
      }
      
      // Bedrooms Match
      if (prefs.bedrooms && prefs.bedrooms > 0 && p.bedrooms) {
        if (p.bedrooms >= prefs.bedrooms) {
          score += 5;
        }
      }
      
      // Add deterministic jitter (0-4) based on ID for organic variation
      let seed = 0;
      const idStr = String(p._id);
      for(let i=0; i<idStr.length; i++) seed += idStr.charCodeAt(i);
      score += (seed % 5);
      score = Math.min(score, 99);
      
      return { ...p, matchScore: score };
    });
    
    // Sort by descending match score
    scoredListings.sort((a, b) => b.matchScore - a.matchScore);
    
    // Return top matches
    res.json(scoredListings.slice(0, 12));
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate matches' });
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