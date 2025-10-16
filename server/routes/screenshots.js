const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// Serve screenshots from database as base64 data URLs
router.get('/page/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    
    console.log(`Attempting to serve screenshot for page: ${pageId}`);
    
    // Get screenshot data from database
    const result = await pool.query(`
      SELECT screenshot_data, image_size, image_format, url, title
      FROM discovered_pages 
      WHERE id = $1 AND screenshot_data IS NOT NULL
    `, [pageId]);
    
    if (result.rows.length === 0) {
      console.log(`Screenshot not found for page: ${pageId}`);
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    
    const page = result.rows[0];
    const { screenshot_data, image_size, image_format, url, title } = page;
    
    // Validate image format for security
    const allowedFormats = ['png', 'jpg', 'jpeg'];
    const format = (image_format || 'png').toLowerCase();
    
    if (!allowedFormats.includes(format)) {
      return res.status(400).json({ error: 'Invalid image format' });
    }
    
    // Determine MIME type
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    
    // Return as JSON with base64 data URL and metadata
    res.json({
      dataUrl: `data:${mimeType};base64,${screenshot_data}`,
      pageId: pageId,
      url: url,
      title: title,
      size: image_size,
      format: image_format
    });
    
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

// Legacy endpoint for backward compatibility (by filename)
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Extract page info from filename pattern: testRunId_timestamp.png
    const match = filename.match(/^(\d+)_(\d+)\.(\w+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid filename format' });
    }
    
    const [, testRunId, timestamp] = match;
    
    // Try to find the screenshot by test run and approximate timestamp
    const result = await pool.query(`
      SELECT id, screenshot_data, image_size, image_format, url, title
      FROM discovered_pages 
      WHERE test_run_id = $1 AND screenshot_data IS NOT NULL
      ORDER BY discovered_at ASC
      LIMIT 1
    `, [testRunId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screenshot not found' });
    }
    
    const page = result.rows[0];
    const format = (page.image_format || 'png').toLowerCase();
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    
    res.json({
      dataUrl: `data:${mimeType};base64,${page.screenshot_data}`,
      pageId: page.id,
      url: page.url,
      title: page.title,
      size: page.image_size,
      format: page.image_format
    });
    
  } catch (error) {
    console.error('Error serving legacy screenshot:', error);
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

module.exports = router;