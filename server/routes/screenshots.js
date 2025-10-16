const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// Serve screenshots from database as base64 data URLs
router.get('/page/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    
    console.log(`Attempting to serve screenshot for page ID: ${pageId}`);
    
    // Get screenshot data from database
    const result = await pool.query(`
      SELECT screenshot_data, image_size, image_format, url, title
      FROM discovered_pages 
      WHERE id = $1 AND screenshot_data IS NOT NULL
    `, [pageId]);
    
    if (result.rows.length === 0) {
      // Check if page exists but without screenshot
      const pageCheck = await pool.query(`
        SELECT id, url, title, screenshot_data
        FROM discovered_pages 
        WHERE id = $1
      `, [pageId]);
      
      if (pageCheck.rows.length === 0) {
        console.log(`Page not found: ${pageId}`);
        return res.status(404).json({ error: 'Page not found' });
      } else {
        console.log(`Page found but no screenshot data for page: ${pageId}, URL: ${pageCheck.rows[0].url}`);
        console.log(`Screenshot data exists: ${pageCheck.rows[0].screenshot_data ? 'YES' : 'NO'}`);
        return res.status(404).json({ 
          error: 'Screenshot not found',
          pageExists: true,
          url: pageCheck.rows[0].url
        });
      }
    }
    
    const page = result.rows[0];
    const { screenshot_data, image_size, image_format, url, title } = page;
    
    console.log(`Found screenshot for page ${pageId}: ${image_size} bytes, format: ${image_format}`);
    
    // Validate image format for security
    const allowedFormats = ['png', 'jpg', 'jpeg'];
    const format = (image_format || 'png').toLowerCase();
    
    if (!allowedFormats.includes(format)) {
      console.log(`Invalid image format: ${format}`);
      return res.status(400).json({ error: 'Invalid image format' });
    }
    
    // Determine MIME type
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    
    console.log(`Serving screenshot for page ${pageId}: ${url}`);
    
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