const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Serve screenshot files
router.get('/:filename', authenticateToken, (req, res) => {
  try {
    const { filename } = req.params;
    const screenshotPath = path.join(__dirname, '../screenshots', filename);
    
    // Check if file exists
    if (!fs.existsSync(screenshotPath)) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    
    // Validate file extension for security
    const allowedExtensions = ['.png', '.jpg', '.jpeg'];
    const fileExtension = path.extname(filename).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    // Set appropriate content type
    const contentType = fileExtension === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    
    // Send file
    res.sendFile(screenshotPath);
    
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

module.exports = router;