const jwt = require('jsonwebtoken');
const User = require('../models/User'); // Standardized capitalization

// The standard bouncer: Checks if you are logged in
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Find user but hide the password
      req.user = await User.findById(decoded.id).select('-password');
      return next(); // FIX: Added return here
    } catch (error) {
      console.error(error);
      return res.status(401).json({ message: 'Not authorized, token failed' }); // FIX: Added return here
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' }); // FIX: Added return here
  }
};

// The VIP bouncer: Checks if you are a Master Admin
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next(); // Let them pass
  } else {
    res.status(403).json({ message: 'Access Denied: You are not an Admin' });
  }
};

module.exports = { protect, admin };