const mongoose = require('mongoose');

const blacklistedTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});

// MongoDB TTL index: auto-deletes documents once expiresAt passes
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.BlacklistedToken || mongoose.model('BlacklistedToken', blacklistedTokenSchema);
