require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const upload = require('./utils/upload');
const path = require('path');
const fs = require('fs');

// Initialize the App
const app = express();

// Connect to Database
connectDB();

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
// helmet: Sets secure HTTP headers (CSP, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",           // Needed for inline scripts in HTML pages
        "https://accounts.google.com",
        "https://fonts.googleapis.com",
        "https://unpkg.com",         // Leaflet map on listings page
      ],
      // Helmet blocks onclick/onerror HTML attributes by default; allow them
      // because the app uses onclick="goDetail(...)" throughout card components.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",           // Needed for inline styles
        "https://fonts.googleapis.com",
        "https://unpkg.com",         // Leaflet CSS on listings page
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      connectSrc: ["'self'", "http://localhost:5000", "https://oauth2.googleapis.com"],
      frameSrc: ["https://accounts.google.com"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allows Google OAuth iframe
}));

// compression: gzip all responses — reduces payload size by ~30–70%
app.use(compression());

// cookie-parser: Parses httpOnly cookies for JWT auth
app.use(cookieParser());

// ── CORS ─────────────────────────────────────────────────────
// credentials: true is required so the browser sends cookies cross-origin
const allowedOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501',
  'http://localhost:3000',
  process.env.CLIENT_URL,          // Production frontend URL from .env
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed'));
  },
  credentials: true,               // Required for cookies to be sent cross-origin
}));

app.use(express.json()); 

// MAKE UPLOADS FOLDER PUBLIC
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API ROUTES ───────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/user', require('./routes/user'));
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api/admin', require('./routes/admin'));

// ── IMAGE UPLOAD ROUTE ────────────────────────────────────────
app.post('/api/upload', upload.array('images', 15), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No images uploaded' });
  }
  
  const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
  
  res.status(201).json({ 
    imageUrls: imageUrls,
    imageUrl: imageUrls[0]
  });
});

// ── SERVE FRONTEND (Production Setup) ─────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 NestIQ server running on port ${PORT}`);
  console.log(`🛡️  Helmet security headers: ON`);
  console.log(`⚡ Gzip compression: ON`);
  console.log(`🍪 Cookie parser: ON`);
});