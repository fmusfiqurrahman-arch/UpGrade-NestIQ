const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  type: { type: String, enum: ['message', 'booking', 'match', 'owner_request', 'contact'], required: true },
  content: { type: String },
  // Captured for guest (non-logged-in) senders
  senderName:  { type: String, default: '' },
  senderEmail: { type: String, default: '' },
  senderPhone: { type: String, default: '' },
  subject:     { type: String, default: '' },
  status: { type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' }
}, { timestamps: true });

inquirySchema.index({ sender: 1, listing: 1 });

module.exports = mongoose.models.Inquiry || mongoose.model('Inquiry', inquirySchema);
