const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  priceUnit: { type: String, default: 'total' }, // e.g., '/mo' or 'total'
  
  // Location split to match frontend
  area: { type: String, required: true },
  city: { type: String, required: true },
  
  // 'buy' is normalized to 'sale' before saving — DB only ever contains 'rent' or 'sale'
  propertyType: { type: String, enum: ['rent', 'sale'], required: true },
  bedrooms: { type: Number, required: true },
  bathrooms: { type: Number, required: true },
  sqft: { type: Number, required: true },
  
  // Smart Image Management
  image: { type: String },
  images: [{ type: String }],
  amenities: [{ type: String }],
  rules: [{ type: String }],

  // Geographic coordinates for map view
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Moderation
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: { type: String, default: '' },
}, { timestamps: true });

// Compound index covers the most common public query: approved listings by type, sorted by date
listingSchema.index({ status: 1, propertyType: 1, createdAt: -1 });
listingSchema.index({ price: 1 });
listingSchema.index({ owner: 1 });
// 2dsphere index for geo queries once coordinates are added
listingSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.models.Listing || mongoose.model('Listing', listingSchema);