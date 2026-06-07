const jwt = require('jsonwebtoken');
const User = require('../models/User');
const BlacklistedToken = require('../models/BlacklistedToken');

// ── PROTECT MIDDLEWARE ────────────────────────────────────────
// Reads JWT from:
//   1. httpOnly cookie 'nestiq_token'  (preferred — secure)
//   2. Authorization: Bearer <token>   (fallback — for API clients / Postman)
const protect = async (req, res, next) => {
  let token;

  // Priority 1: httpOnly cookie
  if (req.cookies && req.cookies.nestiq_token) {
    token = req.cookies.nestiq_token;
  }
  // Priority 2: Authorization header (API clients)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Revocation check: reject tokens that have been explicitly logged out
    const isRevoked = await BlacklistedToken.exists({ token });
    if (isRevoked) {
      return res.status(401).json({ message: 'Not authorized, token has been revoked' });
    }

    // Attach user to request — exclude password field
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

// ── ADMIN MIDDLEWARE ──────────────────────────────────────────
// Must be used AFTER protect — checks if the authenticated user is an admin
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ message: 'Access Denied: Admins only' });
};

// ── OPTIONAL AUTH MIDDLEWARE ──────────────────────────────────
// Attaches req.user if a valid token is present, but never blocks the request.
// Used on public routes that behave differently for logged-in users.
const optionalAuth = async (req, res, next) => {
  let token;
  if (req.cookies && req.cookies.nestiq_token) {
    token = req.cookies.nestiq_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const isRevoked = await BlacklistedToken.exists({ token });
      if (!isRevoked) {
        req.user = await User.findById(decoded.id).select('-password');
      }
    } catch (_) {
      // Invalid/expired token — treat as guest
    }
  }
  next();
};

module.exports = { protect, admin, optionalAuth };