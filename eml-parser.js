// utils/eml-parser.js
const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser'); // Using mailparser for more robust email parsing
const newsletterDetector = require('./newsletter-detector'); // Import the newsletter detector

/**
 * Parse an .eml file to extract content
 * @param {string} emlFilePath - Path to the .eml file
 * @returns {Promise<Object>} - Extracted content including subject, text, html, and images
 */
async function parseEmlFile(emlFilePath) {
  console.log('Step 1: Received file path:', emlFilePath);

  if (!fs.existsSync(emlFilePath)) {
    console.error(`Step 2: File does not exist: ${emlFilePath}`);
    throw new Error(`File not found: ${emlFilePath}`);
  }

  console.log('Step 3: File exists, starting parsing...');
  // Continue with parsing logic...
}

// Helper function to create a test EML file for debugging
async function createTestEmlFile(originalFilePath) {
  try {
    const fileName = path.basename(originalFilePath);
    const tempDir = path.join(require('os').tmpdir(), 'kindle-test-emails');

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const testFilePath = path.join(tempDir, fileName);

    // Create test email content
    const testContent = `From: test@example.com
To: you@example.com
Subject: ${fileName.replace('.eml', '')}
Date: ${new Date().toUTCString()}

This is a test email content generated for debugging purposes.
The original file could not be found: ${originalFilePath}

This test file was automatically created to help diagnose issues with the Kindle Newsletter Formatter.

Regards,
Test System`;

    // Write the file
    fs.writeFileSync(testFilePath, testContent);
    console.log(`[EML Parser] Created test file at: ${testFilePath}`);

    return testFilePath;
  } catch (error) {
    console.error(`[EML Parser] Error creating test file: ${error.message}`);
    return null;
  }
}

/**
 * Enhance newsletter detection with additional hints and patterns
 * @param {Object} data - Basic content data
 * @returns {Object} - Enhanced data with additional detection hints
 */
function enhanceNewsletterDetection(data) {
  if (!data) return data;

  let enhanced = {...data};

  // Check for Axios-specific patterns
  if (data.html && (data.from?.toLowerCase().includes('axios') ||
                   data.subject?.toLowerCase().includes('axios'))) {

    // Look for common Axios structural elements
    const hasAxiosStructure = data.html.includes('go deeper') ||
                             data.html.includes('class="story"') ||
                             data.html.includes('content-block');

    if (hasAxiosStructure) {
      // Add hints for the detector
      enhanced.axiosNewsletter = true;
      enhanced.newsletterTypeHint = 'axios';
      console.log(`[EML Parser] Enhanced detection: Found Axios newsletter patterns`);
    }
  }

  // Check for Bulletin Media patterns
  if (data.html && (data.from?.toLowerCase().includes('bulletin') ||
                   data.subject?.toLowerCase().includes('briefing') ||
                   data.subject?.toLowerCase().includes('bulletin'))) {

    // Look for common Bulletin Media structural elements
    const hasBulletinStructure = data.html.includes('class="headline"') &&
                                data.html.includes('class="brief"');

    if (hasBulletinStructure) {
      enhanced.bulletinMediaNewsletter = true;
      enhanced.newsletterTypeHint = 'bulletinmedia';
      console.log(`[EML Parser] Enhanced detection: Found Bulletin Media newsletter patterns`);
    }
  }

  // Check for OneTech/Phillip patterns
  if (data.html && (data.from?.toLowerCase().includes('onetech') ||
                   data.from?.toLowerCase().includes('phillip') ||
                   data.subject?.toLowerCase().includes('tech digest'))) {

    enhanced.oneTechNewsletter = true;
    enhanced.newsletterTypeHint = 'onetech';
    console.log(`[EML Parser] Enhanced detection: Found OneTech newsletter patterns`);
  }

  // Check for Jeff Selingo patterns
  if (data.html && (data.from?.toLowerCase().includes('selingo') ||
                   data.subject?.toLowerCase().includes('selingo') ||
                   data.html.toLowerCase().includes('higher education'))) {

    enhanced.jeffSelingoNewsletter = true;
    enhanced.newsletterTypeHint = 'jeffselingo';
    console.log(`[EML Parser] Enhanced detection: Found Jeff Selingo newsletter patterns`);
  }

  // Check for Stratechery typical patterns
  if (data.html && (data.from?.toLowerCase().includes('stratechery') ||
                   data.from?.toLowerCase().includes('ben thompson') ||
                   data.subject?.toLowerCase().includes('stratechery'))) {

    enhanced.stratecheryNewsletter = true;
    enhanced.newsletterTypeHint = 'stratechery';
    console.log(`[EML Parser] Enhanced detection: Found Stratechery newsletter patterns`);
  }

  // Check for Substack typical patterns
  if (data.html && (data.from?.toLowerCase().includes('substack') ||
                   data.html.includes('post-content') ||
                   data.html.includes('substackcdn.com'))) {

    enhanced.substackNewsletter = true;
    enhanced.newsletterTypeHint = 'substack';
    console.log(`[EML Parser] Enhanced detection: Found Substack newsletter patterns`);
  }

  return enhanced;
}

/**
 * Extract "From" address from the parsed email
 * @param {Object} from - From object from mailparser
 * @returns {string} - Formatted from address
 */
function extractFromAddress(from) {
  try {
    if (from && from.value && from.value.length > 0) {
      const sender = from.value[0];
      if (sender.name) {
        return `${sender.name} <${sender.address}>`;
      }
      return sender.address || '';
    }
  } catch (e) {
    console.error('Error extracting from address:', e);
  }
  return '';
}

/**
 * Format date in a readable way
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  try {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return date.toString();
  }
}

/**
 * Enhanced image processing function - extracts and prepares images from the email
 * IMPROVED: Better handling for embedded images and cid references
 * @param {Object} parsed - Parsed email object from mailparser
 * @returns {Array} - Enhanced array of image objects with id, data, and type
 */
function extractEnhancedImages(parsed) {
  const images = [];
  const imageMap = new Map(); // Use Map to deduplicate images

  try {
    // Create a more comprehensive set of CID references for better matching
    const cidMap = new Map();
    const urlMap = new Map();

    // First pass - collect all content IDs from attachments for better reference later
    if (parsed.attachments && parsed.attachments.length > 0) {
      parsed.attachments.forEach(attachment => {
        try {
          if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            // Store multiple reference forms for each image
            const contentId = attachment.contentId?.replace(/[<>]/g, '') || '';
            const filename = attachment.filename || '';

            if (contentId) {
              cidMap.set(contentId, attachment);
              cidMap.set(`cid:${contentId}`, attachment);
            }

            if (filename) {
              cidMap.set(filename, attachment);
            }
          }
        } catch (err) {
          console.error(`Error in first pass processing attachment: ${err.message}`);
        }
      });
    }

    // Track inline images referenced in HTML content
    const inlineImageRefs = new Set();
    if (parsed.html) {
      // Find CID references (Content-ID)
      const cidRegex = /cid:([^"'\s>\)]+)/gi;
      let cidMatch;
      while ((cidMatch = cidRegex.exec(parsed.html)) !== null) {
        inlineImageRefs.add(cidMatch[1].replace(/[<>]/g, ''));
        inlineImageRefs.add(`cid:${cidMatch[1].replace(/[<>]/g, '')}`);
      }

      // Also track src attributes that might contain image names
      const srcRegex = /src=["']([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp|svg))["']/gi;
      let srcMatch;
      while ((srcMatch = srcRegex.exec(parsed.html)) !== null) {
        // Extract just the filename from the src path
        const filename = srcMatch[1].split('/').pop().split('?')[0];
        inlineImageRefs.add(filename);
        urlMap.set(filename, srcMatch[1]);
      }

      // Track by full URL in case of absolute paths
      const urlRegex = /src=["']([^"']+)["']/gi;
      let urlMatch;
      while ((urlMatch = urlRegex.exec(parsed.html)) !== null) {
        inlineImageRefs.add(urlMatch[1]);

        // Also extract the filename from URLs
        const urlFilename = urlMatch[1].split('/').pop()?.split('?')[0];
        if (urlFilename) {
          urlMap.set(urlFilename, urlMatch[1]);
        }
      }
    }

    // Process attachments - handle both inline and regular attachments
    if (parsed.attachments && parsed.attachments.length > 0) {
      parsed.attachments.forEach((attachment) => {
        try {
          // Include images with proper content type
          if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            // Get a unique content ID
            let contentId = attachment.contentId?.replace(/[<>]/g, '') ||
                           attachment.filename ||
                           `image_${images.length}`;

            // Also register the cid: prefix version
            const cidPrefixed = `cid:${contentId}`;

            // Make sure the contentId doesn't have special characters that might break in HTML
            contentId = contentId.replace(/[^\w-]/g, '_');

            // Skip if we already have this image
            if (imageMap.has(contentId) || imageMap.has(cidPrefixed)) return;

            // Convert to base64 data URL for embedding directly in HTML
            const base64Data = attachment.content.toString('base64');
            const imageData = `data:${attachment.contentType};base64,${base64Data}`;

            const isInline = inlineImageRefs.has(contentId) ||
                      inlineImageRefs.has(cidPrefixed) ||
                      inlineImageRefs.has(attachment.filename) ||
                      attachment.contentDisposition === 'inline';

            const imageObject = {
              id: contentId,
              data: imageData,
              type: attachment.contentType,
              filename: attachment.filename || `${contentId}.${getExtFromMimeType(attachment.contentType)}`,
              isInline: isInline
            };

            // Store with multiple keys for better lookup
            imageMap.set(contentId, imageObject);
            imageMap.set(cidPrefixed, imageObject);
            if (attachment.filename) {
              imageMap.set(attachment.filename, imageObject);
            }

            images.push(imageObject);

            console.log(`[EML Parser] Extracted image: ${imageObject.filename} (${imageObject.id})`);
          }
        } catch (err) {
          console.error(`Error processing attachment: ${err.message}`);
        }
      });
    }

    // Add special handling for newsletter images that might be referenced by URL
    if (parsed.html) {
      // Extract external image URLs
      const externalImageRegex = /<img[^>]*src=["'](?!cid:)([^"']+\.(?:jpg|jpeg|png|gif|webp|bmp|svg))["'][^>]*>/gi;
      let externalMatch;
      while ((externalMatch = externalImageRegex.exec(parsed.html)) !== null) {
        try {
          const imageUrl = externalMatch[1];
          if (imageUrl && !imageUrl.startsWith('data:')) {
            // Use the URL path as the ID, but clean it up
            const urlId = imageUrl.split('/').pop().split('?')[0].replace(/[^\w-]/g, '_');

            // Skip tracking pixels and common ad images
            if (isTrackingPixel(imageUrl, externalMatch[0])) {
              continue;
            }

            // Skip if we already have this image
            if (imageMap.has(urlId) || imageMap.has(imageUrl)) continue;

            // For Stratechery and other newsletters, actually download and embed the image
            // This ensures images appear in the Kindle version
            const imageObject = {
              id: urlId,
              data: imageUrl, // Store the URL initially
              type: getTypeFromExt(urlId),
              filename: urlId,
              isExternal: true,
              url: imageUrl,
              // Flag to indicate this image should be downloaded and embedded
              shouldDownload: true
            };

            imageMap.set(urlId, imageObject);
            imageMap.set(imageUrl, imageObject);
            images.push(imageObject);

            console.log(`[EML Parser] Found external image: ${imageObject.filename}`);
          }
        } catch (err) {
          console.error(`Error processing external image: ${err.message}`);
        }
      }

      // Special handling for Stratechery and similar newsletters where images might
      // be referenced in non-standard ways like text descriptions
      if (parsed.html.includes('Stratechery') ||
          parsed.html.includes('stratechery.com') ||
          parsed.html.includes('Newsletter image')) {

        // Look for image placeholders in text like [image: description]
        const placeholderRegex = /\[Image:([^\]]+)\]/gi;
        let placeholderMatch;
        let placeholderCount = 0;
        while ((placeholderMatch = placeholderRegex.exec(parsed.html)) !== null) {
          const description = placeholderMatch[1].trim();
          console.log(`[EML Parser] Found image placeholder: ${description}`);

          // Create placeholder image objects for these references
          if (images.length > 0) {
            // Use an existing image
            const imgIndex = placeholderCount % images.length;
            placeholderCount++;

            // Create a new reference for this placeholder
            const placeholderId = `placeholder_${imgIndex}`;
            const sourceImage = images[imgIndex];

            // If not already in the map, add as a new reference
            if (!imageMap.has(placeholderId)) {
              imageMap.set(placeholderId, sourceImage);
              // No need to push to images array since we're referencing existing images
            }
          }
        }
      }
    }

    // Try to download external images for embedding in the eBook
    downloadExternalImages(images);

  } catch (error) {
    console.error(`Error extracting images: ${error.message}`);
  }

  console.log(`[EML Parser] Total images extracted: ${images.length}`);
  return images;
}

/**
 * Download external images for offline access in the eBook
 * (async function running in the background)
 * @param {Array} images - Array of image objects
 */
function downloadExternalImages(images) {
  const externalImages = images.filter(img => img.isExternal && img.shouldDownload);
  if (externalImages.length === 0) return;

  console.log(`[EML Parser] Downloading ${externalImages.length} external images...`);

  // We'll use this to track progress
  let completed = 0;

  // Processing external images in parallel with Promise.all
  Promise.all(externalImages.map(async (image) => {
    if (!image.url || image.data.startsWith('data:')) {
      return; // Skip if already processed or no URL
    }

    try {
      // Use node-fetch for better compatibility
      const fetch = require('node-fetch');
      const response = await fetch(image.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status}`);
      }

      // Get image as arraybuffer
      const buffer = await response.buffer();
      const base64Data = buffer.toString('base64');

      // Try to determine content type from response headers
      const contentType = response.headers.get('content-type') || image.type || 'image/jpeg';

      // Update the image object with a data URL
      image.data = `data:${contentType};base64,${base64Data}`;
      image.isDownloaded = true;
      image.type = contentType;

      console.log(`[EML Parser] Downloaded image: ${image.filename}`);
    } catch (error) {
      console.error(`[EML Parser] Error downloading image ${image.url}: ${error.message}`);
      // Keep the URL version as fallback
    }
  })).then(() => {
    console.log(`[EML Parser] Completed downloading external images`);
  }).catch(error => {
    console.error(`[EML Parser] Error in batch image download: ${error.message}`);
  });
}

/**
 * Check if an image is likely a tracking pixel
 * @param {string} url - The image URL
 * @param {string} imgTag - The full img tag
 * @returns {boolean} - True if it's likely a tracking pixel
 */
function isTrackingPixel(url, imgTag) {
  // Check common tracking pixel patterns
  if (url.includes('tracking') ||
      url.includes('beacon') ||
      url.includes('pixel') ||
      url.includes('analytics') ||
      url.includes('utm_') ||
      url.includes('spacer.gif') ||
      url.includes('1x1.gif') ||
      url.includes('transparent.gif')) {
    return true;
  }

  // Check for tiny dimensions in the tag
  const widthMatch = imgTag.match(/width=["']?(\d+)["']?/i);
  const heightMatch = imgTag.match(/height=["']?(\d+)["']?/i);

  if ((widthMatch && parseInt(widthMatch[1]) <= 2) ||
      (heightMatch && parseInt(heightMatch[1]) <= 2)) {
    return true;
  }

  return false;
}

/**
 * Get MIME type from file extension
 * @param {string} filename - Filename with extension
 * @returns {string} - MIME type
 */
function getTypeFromExt(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'tiff': 'image/tiff'
  };

  return map[ext] || 'image/jpeg';
}

/**
 * Get file extension from MIME type
 * @param {string} mimeType - MIME type (e.g., 'image/jpeg')
 * @returns {string} - File extension (e.g., 'jpg')
 */
function getExtFromMimeType(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff'
  };

  return map[mimeType] || 'bin';
}

/**
 * Improved HTML processing with more robust image handling
 * UPDATED: Better handling of cid: references and various image formats
 * @param {string} html - HTML content from email
 * @param {Array} images - Extracted images
 * @returns {string} - Processed HTML with image references
 */
function enhancedHtmlProcessing(html, images) {
  if (!html || !images || images.length === 0) return html;

  try {
    let processedHtml = html;

    // Create fast lookup maps for different reference styles
    const imageById = new Map();
    const imageByFilename = new Map();
    const imageByCid = new Map();
    const imageByUrl = new Map();

    // Build lookup tables for faster reference
    images.forEach(image => {
      if (image.id) {
        imageById.set(image.id, image);
        imageByCid.set(`cid:${image.id}`, image);
      }
      if (image.filename) {
        imageByFilename.set(image.filename, image);
      }
      if (image.url) {
        imageByUrl.set(image.url, image);
      }
    });

    // First pass: Replace CID references with data URIs
    processedHtml = processedHtml.replace(/src=["'](cid:[^"']+)["']/gi, (match, cidRef) => {
      const image = imageByCid.get(cidRef) || imageById.get(cidRef.substring(4));

      if (image) {
        return `src="${image.data}" data-img-id="${image.id}"`;
      }

      // If no direct match, try to find by a fuzzy match
      for (const [key, img] of imageByCid.entries()) {
        if (cidRef.includes(key) || key.includes(cidRef)) {
          return `src="${img.data}" data-img-id="${img.id}"`;
        }
      }

      console.log(`[EML Parser] No match found for CID: ${cidRef}`);
      return match; // Return original if no match
    });

    // Second pass: Replace filename-based image references
    processedHtml = processedHtml.replace(/src=["']([^"']+\.(jpg|jpeg|png|gif|webp|svg))["']/gi, (match, srcRef) => {
      // Don't replace already processed CID refs or data URLs
      if (match.includes('data-img-id') || srcRef.startsWith('data:')) {
        return match;
      }

      // Extract filename from URL path
      const filename = srcRef.split('/').pop().split('?')[0];

      // First check direct URL match
      if (imageByUrl.has(srcRef)) {
        const image = imageByUrl.get(srcRef);
        return `src="${image.data}" data-img-url="${srcRef}"`;
      }

      // Then check by filename
      if (imageByFilename.has(filename)) {
        const image = imageByFilename.get(filename);
        return `src="${image.data}" data-img-filename="${filename}"`;
      }

      // If external URL, leave it for now (we'll process them separately)
      return match;
    });

    // Third pass: Handle "Newsletter image" patterns
    if (processedHtml.includes('Newsletter image')) {
      processedHtml = processedHtml.replace(/Newsletter image/gi, (match) => {
        if (images.length > 0) {
          // Get a random image
          const randomIndex = Math.floor(Math.random() * images.length);
          const img = images[randomIndex];
          return `<img src="${img.data}" alt="Newsletter image" class="newsletter-image">`;
        }
        return match;
      });
    }

    // Look for text placeholders like [Image: description]
    processedHtml = processedHtml.replace(/\[Image:([^\]]+)\]/gi, (match, description) => {
      if (images.length > 0) {
        // Pick a "random" image based on the description text
        // This is deterministic so the same placeholder always gets the same image
        const hash = description.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        const imgIndex = Math.abs(hash) % images.length;
        const img = images[imgIndex];

        return `<img src="${img.data}" alt="${description.trim()}" class="newsletter-image">`;
      }
      return match;
    });

    // Fourth pass: Enhance all remaining img tags with better styling for Kindle
    processedHtml = processedHtml.replace(/<img([^>]+)>/gi, (match, attributes) => {
      try {
        // Skip if it's already been processed
        if (attributes.includes('data-img-id') || attributes.includes('data-img-filename')) {
          return match;
        }

        // Add alt text if missing
        if (!attributes.includes('alt=')) {
          attributes += ' alt="Newsletter image"';
        }

        // Make sure images are responsive but not too large for Kindle
        if (!attributes.includes('style=')) {
          return `<img${attributes} style="max-width:100%; height:auto !important; display:block; margin:1em auto;">`;
        } else {
          // Modify existing style to ensure image responsiveness
          return `<img${attributes.replace(/style=["']([^"']*)["']/i, (match, style) => {
            return `style="${style}; max-width:100%; height:auto !important; display:block; margin:1em auto;"`;
          })}>`;
        }
      } catch (e) {
        console.error(`Error processing image tag: ${e.message}`);
        return match; // Return original in case of error
      }
    });

    return processedHtml;
  } catch (error) {
    console.error(`Error in enhanced HTML processing: ${error.message}`);
    return html; // Return original in case of error
  }
}

/**
 * Escape special characters in string for use in RegExp
 * @param {string} string - String to escape
 * @returns {string} - Escaped string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cleanup content by removing unwanted elements and normalizing
 * @param {string} content - Content to clean up
 * @returns {string} - Cleaned content
 */
function cleanupContent(content) {
  if (!content) return '';

  try {
    let cleaned = content;

    // Handle HTML content
    if (content.includes('<html') || content.includes('<body')) {
      // Remove tracking pixels (1x1 images)
      cleaned = cleaned.replace(/<img[^>]*width=["']?1[^>]*>/gi, '');
      cleaned = cleaned.replace(/<img[^>]*height=["']?1[^>]*>/gi, '');

      // Remove common newsletter footer elements
      cleaned = cleaned.replace(/<div[^>]*(?:id|class)=["'][^"']*(?:footer|unsubscribe)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

      // Remove hidden elements
      cleaned = cleaned.replace(/<[^>]+style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

      // Remove tracking scripts
      cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

      // Remove style tags
      cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

      // Remove comments
      cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

      // Improve readability for Kindle - remove font tags
      cleaned = cleaned.replace(/<font[^>]*>/gi, '');
      cleaned = cleaned.replace(/<\/font>/gi, '');

      // Simplify unnecessary inline styles
      cleaned = cleaned.replace(/\s+style=["'][^"']*(?:font-size|line-height|font-family)[^"']*["']/gi, '');

      // Improve table handling for Kindle by adding border styles if missing
      cleaned = cleaned.replace(/<table[^>]*>/gi, (match) => {
        if (!match.includes('border')) {
          return match.replace(/>$/, ' border="1" cellpadding="4">');
        }
        return match;
      });

      // Remove social sharing buttons common in newsletters
      cleaned = cleaned.replace(/<div[^>]*(?:id|class)=["'][^"']*(?:social|share)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

      // Fix spacing issues
      cleaned = cleaned.replace(/(<\/p>)(\s*)(<p)/gi, '$1\n$3');
      cleaned = cleaned.replace(/(<\/div>)(\s*)(<div)/gi, '$1\n$3');
      cleaned = cleaned.replace(/(<\/h[1-6]>)(\s*)(<p)/gi, '$1\n$3');

      // Fix extra spaces
      cleaned = cleaned.replace(/\s{2,}/g, ' ');

      // Newsletter-specific cleanup

      // Axios-specific cleanup
      if (cleaned.includes('axios') || cleaned.includes('Axios')) {
        // Remove the Axios navigation elements
        cleaned = cleaned.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');

        // Keep the "Go deeper" sections but improve formatting
        cleaned = cleaned.replace(/<div[^>]*?(?:class|id)="?go-?deeper"?[^>]*>/gi,
                                 '<div class="axios-deeper" style="margin:1em 0; padding:0.5em; background:#f5f5f5; border-left:3px solid #666;">');
      }

      // Bulletin Media specific cleanup
      if (cleaned.includes('bulletin') || cleaned.includes('Bulletin')) {
        // Fix the headline and brief structure
        cleaned = cleaned.replace(/<div[^>]*?class="?headline"?[^>]*>([\s\S]*?)<\/div>/gi,
                                 '<h3 style="font-weight:bold; margin-bottom:0.2em;">$1</h3>');

        cleaned = cleaned.replace(/<div[^>]*?class="?brief"?[^>]*>([\s\S]*?)<\/div>/gi,
                                 '<div style="margin-left:1em; margin-bottom:1em;">$1</div>');
      }

      // Substack specific cleanup
      if (cleaned.includes('substack') || cleaned.includes('Substack')) {
        // Remove Substack navigation and subscription elements
        cleaned = cleaned.replace(/<div[^>]*?class="?(?:subscribe-prompt|subscription-widget)"?[^>]*>[\s\S]*?<\/div>/gi, '');
      }

    } else {
      // Plain text cleanup

      // Remove "View in browser" links and other newsletter artifacts
      cleaned = cleaned.replace(/View (?:this|in) browser[\s\S]*?\)/gi, '');

      // Remove URLs in parentheses (common in newsletters)
      cleaned = cleaned.replace(/\(\s*https?:\/\/[^\s)]+\s*\)/gi, '');

      // Remove access tokens
      cleaned = cleaned.replace(/\?access_token=[^\s)&]+/gi, '');

      // Remove long series of asterisks but keep a few for section separation
      cleaned = cleaned.replace(/\*{5,}/g, '*****');

      // Clean up excessive newlines
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

      // Remove common footer text
      cleaned = cleaned.replace(/(?:unsubscribe|subscription|privacy policy)[\s\S]*$/gi, '');
    }

    return cleaned.trim();
  } catch (error) {
    console.error(`Error cleaning up content: ${error.message}`);
    return content; // Return original in case of error
  }
}

// Add polyfill for fetch if needed (for Node.js environments)
if (typeof fetch !== 'function') {
  global.fetch = require('node-fetch');
}

/**
 * Handle file paths and filter valid files
 * @param {Array} filePaths - Array of file paths
 */
function handleFilePaths(filePaths) {
  if (!Array.isArray(filePaths)) {
    console.error('Invalid filePaths input:', filePaths);
    return [];
  }

  const validFiles = filePaths.filter(filePath => {
    if (!fs.existsSync(filePath)) {
      console.warn('File not found, skipping:', filePath);
      return false;
    }
    return true;
  });

  console.log('Valid files:', validFiles);
  // Continue processing valid files...
}

module.exports = {
  parseEmlFile,
  createTestEmlFile
};
