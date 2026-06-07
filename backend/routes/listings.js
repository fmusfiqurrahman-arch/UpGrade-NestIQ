const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Activity = require('../models/Activity');
const Notification = require('../models/Notification');
const { protect, admin } = require('../middleware/auth');
const { makeCache, bustListingsCache } = require('../middleware/cache');
const { deleteImageFile } = require('../utils/imageUtils');

// ── LISTING VALIDATION RULES ──────────────────────────────────
const listingValidation = [
  body('title').notEmpty().trim().escape().isLength({ max: 200 }),
  body('description').notEmpty().trim().isLength({ max: 5000 }),
  body('price').isNumeric().toFloat(),
  body('area').notEmpty().trim().escape(),
  body('city').notEmpty().trim().escape(),
  body('propertyType').isIn(['rent', 'sale', 'buy']).customSanitizer(v => v === 'buy' ? 'sale' : v),
  body('bedrooms').isInt({ min: 0 }).toInt(),
  body('bathrooms').isInt({ min: 0 }).toInt(),
  body('sqft').isInt({ min: 0 }).toInt(),
];

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

// 2.5 GET SMART RECOMMENDATIONS
// Scoring is done entirely inside MongoDB using $addFields — no JS array sorting needed
router.get('/matches', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('preferences').lean();
    const prefs = user.preferences || {};

    const intentFilter = (prefs.intent && prefs.intent !== 'any')
      ? (prefs.intent === 'buy' ? 'sale' : prefs.intent)
      : null;

    const pipeline = [
      { $match: { status: 'approved' } },
      { $limit: 200 },
      {
        $addFields: {
          matchScore: {
            $let: {
              vars: {
                intentScore: intentFilter
                  ? { $cond: [{ $eq: ['$propertyType', intentFilter] }, 20, 0] }
                  : 10,
                locationScore: prefs.location
                  ? {
                      $cond: [{
                        $or: [
                          { $regexMatch: { input: { $toLower: '$area' }, regex: prefs.location.toLowerCase() } },
                          { $regexMatch: { input: { $toLower: '$city' }, regex: prefs.location.toLowerCase() } },
                        ]
                      }, 15, 0]
                    }
                  : 0,
                budgetScore: (prefs.maxPrice && prefs.maxPrice > 0)
                  ? { $cond: [{ $lte: ['$price', prefs.maxPrice] }, 10, { $cond: [{ $lte: ['$price', prefs.maxPrice * 1.2] }, 5, 0] }] }
                  : 0,
                bedroomScore: (prefs.bedrooms && prefs.bedrooms > 0)
                  ? { $cond: [{ $gte: ['$bedrooms', prefs.bedrooms] }, 5, 0] }
                  : 0,
              },
              in: { $min: [{ $add: [50, '$$intentScore', '$$locationScore', '$$budgetScore', '$$bedroomScore'] }, 99] }
            }
          }
        }
      },
      { $sort: { matchScore: -1 } },
      { $limit: 12 },
      { $project: { title: 1, price: 1, priceUnit: 1, propertyType: 1, area: 1, city: 1, bedrooms: 1, bathrooms: 1, sqft: 1, image: 1, images: 1, amenities: 1, matchScore: 1 } },
    ];

    const results = await Listing.aggregate(pipeline);
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate recommendations' });
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
    setImmediate(() => Notification.create({
      user: listing.owner,
      type: 'listing_approved',
      message: `Your listing "${listing.title}" has been approved and is now live.`,
      meta: { listingId: listing._id }
    }).catch(() => {}));
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
    setImmediate(() => Notification.create({
      user: listing.owner,
      type: 'listing_rejected',
      message: `Your listing "${listing.title}" was not approved${reason ? `: ${reason}` : '.'}`,
      meta: { listingId: listing._id }
    }).catch(() => {}));
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
