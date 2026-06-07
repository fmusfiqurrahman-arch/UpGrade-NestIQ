const fs = require('fs');
const path = require('path');

function deleteImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.includes('/uploads/')) return;
  const filename = imageUrl.split('/uploads/')[1];
  if (!filename) return;
  const filepath = path.join(__dirname, '../uploads', filename);
  fs.unlink(filepath, (err) => {
    if (err && err.code !== 'ENOENT') console.error('Image delete failed:', filepath, err.message);
  });
}

module.exports = { deleteImageFile };
