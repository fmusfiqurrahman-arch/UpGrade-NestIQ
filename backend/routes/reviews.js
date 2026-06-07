const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Review = require('../models/Review');
const { protect } = require('../middleware/auth');

// GET /api/reviews/:listingId — all reviews for a listing (public)
router.get('/:listingId', async (req, res) => {
  try {
    const reviews = await Review.find({ listing: req.params.listingId })
      .populate('reviewer', 'firstName lastName profilePicUrl')
      .sort({ createdAt: -1 })
      .lean();

    const avgRating = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : null;

    res.json({ reviews, avgRating, count: reviews.length });
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch reviews' });
  }
});

// POST /api/reviews/:listingId — submit a review (logged-in users only)
router.post('/:listingId', protect, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().trim().isLength({ max: 1000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

  try {
    const review = await Review.create({
      listing: req.params.listingId,
      reviewer: req.user._id,
      rating: req.body.rating,
      comment: req.body.comment || '',
    });
    const populated = await review.populate('reviewer', 'firstName lastName profilePicUrl');
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'You have already reviewed this listing.' });
    }
    res.status(500).json({ message: 'Could not submit review' });
  }
});

// DELETE /api/reviews/:listingId — delete own review
router.delete('/:listingId', protect, async (req, res) => {
  try {
    const deleted = await Review.findOneAndDelete({ listing: req.params.listingId, reviewer: req.user._id });
    if (!deleted) return res.status(404).json({ message: 'Review not found' });
    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Could not delete review' });
  }
});

module.exports = router;
