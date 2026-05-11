const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, default: '' },
  // null for Google/OAuth users (they have no password)
  password: { type: String, required: false, select: false },

  // Google OAuth
  googleId: { type: String, sparse: true, unique: true },

  // Role & Permissions
  role: { type: String, enum: ['tenant', 'owner', 'admin'], default: 'tenant' },

  // Verification System
  isVerified: { type: Boolean, default: false },
  nidDocUrl: { type: String, default: '' },

  // Profile
  profilePicUrl: { type: String, default: '' },

  // Password Reset
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  // AI Matching Preferences
  preferences: {
    intent: { type: String, enum: ['rent', 'buy', 'any'], default: 'any' },
    location: { type: String, default: '' },
    bedrooms: { type: Number, default: 0 },
    maxPrice: { type: Number, default: 0 }
  }
}, { timestamps: true });

// Auto-heal legacy accounts that may be missing name fields
userSchema.pre('validate', function () {
  if (!this.firstName) this.firstName = 'Unknown';
  if (!this.lastName)  this.lastName  = 'User';
});

// Hash password before saving — skip for OAuth users with no password
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Returns false for OAuth users who have no password field
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);