const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['listing_created', 'listing_saved', 'listing_unsaved', 'inquiry_sent', 'inquiry_received', 'nid_uploaded'],
    required: true
  },
  description: { type: String, required: true },
  meta: { type: Object, default: {} },
}, { timestamps: true });

activitySchema.index({ user: 1, createdAt: -1 });

// Auto-delete activities older than 90 days
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
