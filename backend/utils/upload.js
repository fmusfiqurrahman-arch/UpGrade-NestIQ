const multer = require('multer');
const path = require('path');

// 1. Tell Multer exactly where to save files and sanitize the name
const storage = multer.diskStorage({
  destination(req, file, cb) {
    // FIX: Absolute path guarantees files always go to backend/uploads
    cb(null, path.join(__dirname, '../uploads')); 
  },
  filename(req, file, cb) {
    // FIX: Removes spaces and special characters from the filename so URLs don't break!
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

// 2. Create the upload tool
const upload = multer({
  storage,
  limits: { fileSize: 10000000 }, // Max size: 10MB
  fileFilter(req, file, cb) {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Please upload an image file.'), false);
    }
  }
});

module.exports = upload;