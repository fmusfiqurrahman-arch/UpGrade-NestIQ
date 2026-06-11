require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { upload, validateMagicBytes } = require('./utils/upload');
const path = require('path');
const fs = require('fs');

const app = express();

connectDB();

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://accounts.google.com",
        "https://fonts.googleapis.com",
        "https://unpkg.com",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://unpkg.com",
        "https://accounts.google.com",
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      connectSrc: [
        "'self'",
        "https://oauth2.googleapis.com",
        // Allow localhost only in development — never ships to prod
        ...(process.env.NODE_ENV !== 'production' ? ["http://localhost:5000", "http://127.0.0.1:5000"] : []),
        ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
      ],
      frameSrc: ["https://accounts.google.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(cookieParser());

// ── CORS ─────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501',
  'http://localhost:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: Origin not allowed'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────
// General limiter: 150 requests per minute per IP (covers all routes)
// This prevents a single bad actor from starving the other 1999 users.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
  skip: (req) => req.path.startsWith('/uploads'), // static files don't count
});

// Stricter limiter for write operations that hit the DB or send emails
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

app.use('/api', generalLimiter);
app.use('/api/inquiries', writeLimiter);
app.use('/api/upload', writeLimiter);

// ── STATIC FILES ──────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',         // Browsers cache uploaded images for 7 days
  etag: true,
}));

// ── API ROUTES ───────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/user', require('./routes/user'));
app.use('/api/inquiries', require('./routes/inquiries'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reviews', require('./routes/reviews'));

// ── IMAGE UPLOAD ROUTE ────────────────────────────────────────
const { protect: protectUpload } = require('./middleware/auth');
app.post('/api/upload', protectUpload, upload.array('images', 15), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No images uploaded' });
  }
  try {
    // Magic-byte check: reject any file whose bytes don't match an image signature
    await Promise.all(req.files.map(f => validateMagicBytes(f.path)));
  } catch (err) {
    // validateMagicBytes already deleted the bad file(s)
    return res.status(400).json({ message: err.message });
  }
  const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
  res.status(201).json({ imageUrls, imageUrl: imageUrls[0] });
});

// ── SERVE FRONTEND ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1h',
  etag: true,
}));

app.get(/^(?!\/api)(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// ── HTTP SERVER WITH KEEP-ALIVE TUNING ───────────────────────
// keepAliveTimeout must be > any upstream proxy/load-balancer idle timeout.
// headersTimeout > keepAliveTimeout to avoid a race condition in Node.js.
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

server.listen(PORT, () => {
  console.log(`🚀 NestIQ server running on port ${PORT}`);
  console.log(`🛡️  Helmet security headers: ON`);
  console.log(`⚡ Gzip compression: ON`);
  console.log(`🍪 Cookie parser: ON`);
  console.log(`🔒 Rate limiting: ON (150 req/min general, 30/15min for writes)`);
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────
// PM2 sends SIGINT on restart/stop. We finish in-flight requests before closing.
const shutdown = (signal) => {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    const mongoose = require('mongoose');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
  // Force-kill if graceful close takes too long
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
