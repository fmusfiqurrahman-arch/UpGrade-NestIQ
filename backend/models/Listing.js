const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  priceUnit: { type: String, default: 'total' }, // e.g., '/mo' or 'total'
  
  // Location split to match frontend
  area: { type: String, required: true },
  city: { type: String, required: true },
  
  // NOTE: 'buy' and 'sale' are treated as the same intent. 'buy' is accepted from
  // the frontend but normalized to 'sale' for consistency in the DB.
  propertyType: { type: String, enum: ['rent', 'sale', 'buy'], required: true },
  bedrooms: { type: Number, required: true },
  bathrooms: { type: Number, required: true },
  sqft: { type: Number, required: true },
  
  // Smart Image Management
  image: { type: String }, // Main image for quick access
  images: [{ type: String }], // Array of file paths/URLs
  amenities: [{ type: String }], // Array of selected amenities
  
  owner: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.models.Listing || mongoose.model('Listing', listingSchema);