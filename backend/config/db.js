const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Attempt to connect using the URI from your .env file
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Database Connection Error: ${error.message}`);
    // If the database fails, shut down the server
    process.exit(1); 
  }
};

module.exports = connectDB;