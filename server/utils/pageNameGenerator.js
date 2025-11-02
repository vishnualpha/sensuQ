const logger = require('./logger');

/**
 * Generate a friendly, human-readable name for a page based on its URL
 */
function generatePageName(url, title) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    // Handle root/home page
    if (pathname === '/' || pathname === '') {
      return 'Home Page';
    }

    // Remove leading/trailing slashes and split into segments
    const segments = pathname.replace(/^\/|\/$/g, '').split('/');

    // Filter out empty segments and common patterns
    const meaningfulSegments = segments.filter(seg =>
      seg &&
      seg !== 'index' &&
      seg !== 'index.html' &&
      seg !== 'index.php' &&
      !seg.match(/^\d+$/) // Ignore pure numeric segments (likely IDs)
    );

    // If we have meaningful segments, use them
    if (meaningfulSegments.length > 0) {
      // Take the last meaningful segment as the primary identifier
      const lastSegment = meaningfulSegments[meaningfulSegments.length - 1];

      // Convert kebab-case, snake_case, or camelCase to Title Case
      const pageName = lastSegment
        .replace(/[-_]/g, ' ')  // Replace dashes and underscores with spaces
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space before capital letters
        .replace(/\.(html|php|aspx?|jsp)$/i, '')  // Remove file extensions
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      // Add parent context if available
      if (meaningfulSegments.length > 1) {
        const parentSegment = meaningfulSegments[meaningfulSegments.length - 2];
        const parentName = parentSegment
          .replace(/[-_]/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        return `${parentName} - ${pageName}`;
      }

      return pageName;
    }

    // Check for query parameters that might indicate page type
    if (searchParams.has('page')) {
      const pageParam = searchParams.get('page');
      return pageParam
        .replace(/[-_]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    if (searchParams.has('id') || searchParams.has('view')) {
      const view = searchParams.get('view') || searchParams.get('id');
      return view
        .replace(/[-_]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }

    // Fallback to title if available and meaningful
    if (title && title !== 'DEMOQA' && title.length < 50) {
      return title;
    }

    // Last resort: use the domain name
    return `${urlObj.hostname.replace('www.', '')} Page`;

  } catch (error) {
    logger.warn(`Failed to generate page name for ${url}: ${error.message}`);

    // Emergency fallback: use title or URL
    if (title && title.length < 50) {
      return title;
    }

    return url.substring(url.lastIndexOf('/') + 1) || 'Page';
  }
}

/**
 * Generate a short, descriptive identifier for display
 */
function generatePageIdentifier(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    if (pathname === '/' || pathname === '') {
      return '/';
    }

    // Return the path without domain
    return pathname;

  } catch (error) {
    return url;
  }
}

module.exports = {
  generatePageName,
  generatePageIdentifier
};
