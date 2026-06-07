const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['inquiry_received', 'listing_approved', 'listing_rejected', 'verification_approved'],
    required: true,
  },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  meta: { type: Object, default: {} },
}, { timestamps: true });

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30-day TTL

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
