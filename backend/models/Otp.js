const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true }, // email or phone
  otpCode: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// Auto-delete document after expiration
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
