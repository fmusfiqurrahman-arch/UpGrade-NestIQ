const multer = require('multer');
const path = require('path');

// Allowed MIME types — explicit whitelist (no wildcards)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename(req, file, cb) {
    // Strip unsafe characters from filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-').toLowerCase();
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max (reduced from 10MB)
  fileFilter(req, file, cb) {
    // FIX: Explicit whitelist of allowed MIME types — prevents .html/.js disguised as images
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: JPEG, PNG, WebP, GIF.`), false);
    }
  },
});

module.exports = upload;