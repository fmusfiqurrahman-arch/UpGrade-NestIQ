const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for guest leads
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for admin requests
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  type: { type: String, enum: ['message', 'booking', 'match', 'owner_request'], required: true },
  content: { type: String },
  status: { type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' }
}, { timestamps: true });

inquirySchema.index({ sender: 1, listing: 1 });

module.exports = mongoose.models.Inquiry || mongoose.model('Inquiry', inquirySchema);
