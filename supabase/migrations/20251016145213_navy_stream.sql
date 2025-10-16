/*
  # Add Image Storage to Database

  1. Schema Changes
    - Add `screenshot_data` column to `discovered_pages` table for base64 image storage
    - Add `image_size` column to track image file size
    - Add `image_format` column to track image format (png, jpg, etc.)
    - Keep existing `screenshot_path` for backward compatibility

  2. Performance Considerations
    - Added index on `test_run_id` for faster image retrieval
    - Base64 storage allows for easy API serving without file system dependencies
*/

-- Add image storage columns to discovered_pages table
ALTER TABLE discovered_pages 
ADD COLUMN IF NOT EXISTS screenshot_data TEXT,
ADD COLUMN IF NOT EXISTS image_size INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS image_format VARCHAR(10) DEFAULT 'png';

-- Add index for better performance when retrieving images by test run
CREATE INDEX IF NOT EXISTS idx_discovered_pages_screenshot_data 
ON discovered_pages(test_run_id) 
WHERE screenshot_data IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN discovered_pages.screenshot_data IS 'Base64 encoded screenshot image data';
COMMENT ON COLUMN discovered_pages.image_size IS 'Size of the original image file in bytes';
COMMENT ON COLUMN discovered_pages.image_format IS 'Image format (png, jpg, jpeg, etc.)';