const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Serve screenshot files as base64 data URLs to avoid CORS issues
router.get('/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const screenshotPath = path.join(__dirname, '../screenshots', filename);
    
    console.log(`Attempting to serve screenshot: ${screenshotPath}`);
    
    // Check if file exists
    if (!fs.existsSync(screenshotPath)) {
      console.log(`Screenshot not found: ${screenshotPath}`);
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    
    // Validate file extension for security
    const allowedExtensions = ['.png', '.jpg', '.jpeg'];
    const fileExtension = path.extname(filename).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(screenshotPath);
    const base64Data = fileBuffer.toString('base64');
    
    // Determine MIME type
    const mimeType = fileExtension === '.png' ? 'image/png' : 'image/jpeg';
    
    // Return as JSON with base64 data URL
    res.json({
      dataUrl: `data:${mimeType};base64,${base64Data}`,
      filename: filename,
      size: fileBuffer.length
    });
    
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

module.exports = router;