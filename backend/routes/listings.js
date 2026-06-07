const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Activity = require('../models/Activity');
const { protect, admin } = require('../middleware/auth');
const { makeCache, bustListingsCache } = require('../middleware/cache');
const fs = require('fs');
const path = require('path');

// ── LISTING VALIDATION RULES ──────────────────────────────────
const listingValidation = [
  body('title').notEmpty().trim().escape().isLength({ max: 200 }),
  body('description').notEmpty().trim().isLength({ max: 5000 }),
  body('price').isNumeric().toFloat(),
  body('area').notEmpty().trim().escape(),
  body('city').notEmpty().trim().escape(),
  body('propertyType').isIn(['rent', 'sale', 'buy']),
  body('bedrooms').isInt({ min: 0 }).toInt(),
  body('bathrooms').isInt({ min: 0 }).toInt(),
  body('sqft').isInt({ min: 0 }).toInt(),
];

// ── THE SMART IMAGE JANITOR ──────────────────────────────────
const deleteImageFile = (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('/uploads/')) return;
  const filename = imageUrl.split('/uploads/')[1];
  if (filename) {
    const filepath = path.join(__dirname, '../uploads', filename);
    fs.unlink(filepath, (err) => {
      if (err) console.error("Janitor Failed to delete:", filepath, err.message);
    });
  }
};

// 0. GET PLATFORM STATS — cached 60s
router.get('/stats', makeCache(60), async (req, res) => {
  try {
    const approvedFilter = { status: 'approved' };
    const [totalListings, forRent, forSale, avgPriceResult, usersCount, verifiedUsers] = await Promise.all([
      Listing.countDocuments(approvedFilter),
      Listing.countDocuments({ ...approvedFilter, propertyType: 'rent' }),
      Listing.countDocuments({ ...approvedFilter, propertyType: 'sale' }),
      Listing.aggregate([{ $match: approvedFilter }, { $group: { _id: null, avgPrice: { $avg: '$price' } } }]),
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
    ]);
    res.json({
      totalListings,
      forRent,
      forSale,
      avgPrice: avgPriceResult.length > 0 ? Math.round(avgPriceResult[0].avgPrice) : 0,
      usersCount,
      verifiedUsers,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error: Could not fetch stats' });
  }
});

// 1. GET ALL LISTINGS — cached 30s
router.get('/', makeCache(30), async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = Math.min(parseInt(req.query.limit) || 12, 50); // Cap at 50 per page

    const filter = { status: 'approved' };
    if (req.query.type) filter.propertyType = req.query.type;

    let sortObj = { createdAt: -1 };
    if (req.query.sort === 'price-asc') sortObj = { price: 1 };
    if (req.query.sort === 'price-desc') sortObj = { price: -1 };

    if (page) {
      const skip = (page - 1) * limit;
      const [total, listings] = await Promise.all([
        Listing.countDocuments(filter),
        Listing.find(filter).sort(sortObj).skip(skip).limit(limit).lean(),
      ]);
      res.json({ listings, page, totalPages: Math.ceil(total / limit), totalListings: total });
    } else {
      const listings = await Listing.find(filter).sort(sortObj).lean();
      res.json(listings);
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error: Could not fetch listings' });
  }
});

// 2. GET MY LISTINGS
router.get('/me', protect, async (req, res) => {
  try {
    const myProperties = await Listing.find({ owner: req.user._id }).lean();
    res.json(myProperties);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch your properties' });
  }
});

// 2.5 GET AI MATCHES
// Capped at 100 listings per request (was 500) — still accurate enough for scoring
router.get('/matches', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('preferences').lean();
    const prefs = user.preferences || {};

    const listings = await Listing.find({ status: 'approved' })
      .select('_id title description price propertyType area city bedrooms bathrooms sqft image images amenities')
      .limit(100)
      .lean();

    const scoredListings = listings.map(p => {
      let score = 50;
      const pIntent = (p.propertyType === 'sale' || p.propertyType === 'buy') ? 'buy' : 'rent';
      if (prefs.intent && prefs.intent !== 'any') {
        if (pIntent === prefs.intent) score += 20;
      } else {
        score += 10;
      }
      if (prefs.location) {
        const searchLoc = prefs.location.toLowerCase();
        if ((p.area || '').toLowerCase().includes(searchLoc) || (p.city || '').toLowerCase().includes(searchLoc)) score += 15;
      }
      if (prefs.maxPrice && prefs.maxPrice > 0 && p.price) {
        if (p.price <= prefs.maxPrice) score += 10;
        else if (p.price <= prefs.maxPrice * 1.2) score += 5;
      }
      if (prefs.bedrooms && prefs.bedrooms > 0 && p.bedrooms >= prefs.bedrooms) score += 5;
      let seed = 0;
      const idStr = String(p._id);
      for (let i = 0; i < idStr.length; i++) seed += idStr.charCodeAt(i);
      score = Math.min(score + (seed % 5), 99);
      return { ...p, matchScore: score };
    });

    scoredListings.sort((a, b) => b.matchScore - a.matchScore);
    res.json(scoredListings.slice(0, 12));
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate matches' });
  }
});

// 3. GET A SINGLE LISTING — cached 60s (public), no cache for private access
router.get('/:id', makeCache(60), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).lean();
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.status !== 'approved') {
      let requesterId = null;
      let requesterRole = null;
      const token = (req.cookies && req.cookies.nestiq_token) ||
        (req.headers.authorization && req.headers.authorization.startsWith('Bearer')
          ? req.headers.authorization.split(' ')[1] : null);
      if (token) {
        try {
          const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
          requesterId = decoded.id;
          const u = await User.findById(decoded.id).select('role').lean();
          if (u) requesterRole = u.role;
        } catch (_) {}
      }
      const isOwner = requesterId && String(listing.owner) === String(requesterId);
      if (!isOwner && requesterRole !== 'admin') {
        return res.status(404).json({ message: 'Listing not found' });
      }
    }

    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// 4. CREATE A LISTING
router.post('/', protect, listingValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

  try {
    const listingData = {
      title: req.body.title,
      description: req.body.description,
      price: req.body.price,
      priceUnit: req.body.priceUnit || 'total',
      area: req.body.area,
      city: req.body.city,
      propertyType: req.body.propertyType,
      bedrooms: req.body.bedrooms,
      bathrooms: req.body.bathrooms,
      sqft: req.body.sqft,
      image: req.body.image || '',
      images: Array.isArray(req.body.images) ? req.body.images : [],
      amenities: Array.isArray(req.body.amenities) ? req.body.amenities : [],
      rules: Array.isArray(req.body.rules) ? req.body.rules : [],
      owner: req.user._id,
    };
    const newListing = await Listing.create(listingData);
    bustListingsCache();

    setImmediate(() => Activity.create({
      user: req.user._id,
      type: 'listing_created',
      description: `You submitted "${newListing.title}" for review.`,
      meta: { listingId: newListing._id, listingTitle: newListing.title }
    }).catch(() => {}));

    res.status(201).json(newListing);
  } catch (error) {
    res.status(400).json({ message: 'Failed to create listing: ' + error.message });
  }
});

// 5. UPDATE A LISTING
router.put('/:id', protect, listingValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access Denied: You cannot edit this property' });
    }

    if (req.body.images && Array.isArray(req.body.images)) {
      const oldImages = listing.images || [];
      oldImages.filter(img => !req.body.images.includes(img)).forEach(deleteImageFile);
    }

    const allowed = {};
    ['title','description','price','priceUnit','area','city','propertyType','bedrooms','bathrooms','sqft','image','images','amenities','rules']
      .forEach(f => { if (req.body[f] !== undefined) allowed[f] = req.body[f]; });

    listing = await Listing.findByIdAndUpdate(req.params.id, allowed, { new: true });
    bustListingsCache();
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update property' });
  }
});

// 6. DELETE A LISTING
router.delete('/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    if (listing.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access Denied: You cannot delete this property' });
    }

    if (listing.images && listing.images.length > 0) listing.images.forEach(deleteImageFile);
    await listing.deleteOne();
    bustListingsCache();
    res.json({ message: 'Listing and all associated photos were successfully deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error during deletion' });
  }
});

// 7. ADMIN: GET ALL LISTINGS (includes pending/rejected)
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const listings = await Listing.find({})
      .populate('owner', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// 8. ADMIN: GET PENDING LISTINGS
router.get('/admin/pending', protect, admin, async (req, res) => {
  try {
    const listings = await Listing.find({ status: 'pending' })
      .populate('owner', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// 9. ADMIN: APPROVE A LISTING
router.put('/:id/approve', protect, admin, async (req, res) => {
  try {
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', rejectionReason: '' },
      { new: true }
    );
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    bustListingsCache();
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// 10. ADMIN: REJECT A LISTING
router.put('/:id/reject', protect, admin, async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim().slice(0, 500);
    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', rejectionReason: reason },
      { new: true }
    );
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
