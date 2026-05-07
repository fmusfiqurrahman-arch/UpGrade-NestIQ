// 1. Import Dependencies
require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const jwt = require('jsonwebtoken');
const upload = require('./utils/upload');
const path = require('path');
const Listing = require('./models/Listing'); 
const fs = require('fs');

// 2. Initialize the App
const app = express();

// 3. Connect to Database
connectDB();

// 4. Middleware 
app.use(cors()); 
app.use(express.json()); 

// MAKE UPLOADS FOLDER PUBLIC
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 5. API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/user', require('./routes/user')); // 🚨 The missing link for profile pictures!

// --------------------------------------------------------
// ROUTE: UPLOAD MULTIPLE IMAGES (For Properties)
// --------------------------------------------------------
app.post('/api/upload', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No images uploaded' });
  }
  
  const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
  
  res.status(201).json({ 
    imageUrls: imageUrls,
    imageUrl: imageUrls[0]
  });
});



// --------------------------------------------------------
// SERVE FRONTEND (Production Setup)
// --------------------------------------------------------
app.use(express.static(path.join(__dirname, '../frontend')));

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 6. Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});