const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { fromBuffer } = require('file-type');

// Allowed MIME types — explicit whitelist (no wildcards)
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename(req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-').toLowerCase();
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Layer 1: MIME type from HTTP header (fast, but attacker-controlled)
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF.'), false);
    }
    // Layer 2: File extension check
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Invalid file extension.'), false);
    }
    cb(null, true);
  },
});

// Magic-byte post-upload validator — call this after multer writes the file
// Deletes and rejects any file whose actual content doesn't match an image signature
async function validateMagicBytes(filePath) {
  const buffer = fs.readFileSync(filePath);
  const type = await fromBuffer(buffer);
  if (!type || !ALLOWED_MIME_TYPES.has(type.mime)) {
    fs.unlinkSync(filePath); // Delete the fake file immediately
    throw new Error('File content does not match a valid image type.');
  }
}

module.exports = { upload, validateMagicBytes };