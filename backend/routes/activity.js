const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const { protect } = require('../middleware/auth');

// GET /api/activity — last 20 events for the logged-in user
router.get('/', protect, async (req, res) => {
  try {
    const events = await Activity.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: 'Could not fetch activity' });
  }
});

module.exports = router;
