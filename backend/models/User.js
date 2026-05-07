const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  
  // Role & Permissions
  role: { type: String, enum: ['tenant', 'owner', 'admin'], default: 'tenant' },
  
  // Verification System
  isVerified: { type: Boolean, default: false }, 
  nidDocUrl: { type: String, default: '' },      
  
  // Profile
  profilePicUrl: { type: String, default: '' }
}, { timestamps: true });

// ── LAZY MIGRATION: Auto-heal old accounts ──
userSchema.pre('validate', function () {
  if (!this.firstName) this.firstName = "Unknown";
  if (!this.lastName) this.lastName = "User";
  if (!this.phone) this.phone = "00000000000";
});

// ── THE BUG FIX: Hash password before saving ──
userSchema.pre('save', async function () {
  // We no longer need 'next'. A simple return stops the execution!
  if (!this.isModified('password')) return; 
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare passwords for login
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);