// utils/azw3-generator.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const epub = require('epub-gen');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const temp = require('temp').track(); // Auto-track and clean up temp files

/**
 * Generate an EPUB file from newsletter content
 * With optional conversion to AZW3 if Calibre is installed
 * @param {string} title - Title of the newsletter
 * @param {string} content - HTML content of the newsletter
 * @param {string} format - Format of content ('html', 'markdown', 'text')
 * @param {Object} options - Additional options including template and newsletter info
 * @returns {Promise<{buffer: Buffer, format: string}>} - Buffer containing the generated file and format type
 */
async function generateEbook(title, content, format, options = {}) {
  try {
    console.log(`[Ebook Generator] Starting ebook generation for: ${title}`);

    if (!content || content.trim() === '') {
      content = `<p>No content available for this newsletter.</p>`;
      format = 'html';
    }

    let htmlContent;
    if (format === 'html') {
      // Apply newsletter-specific transformations if available
      if (options.template && typeof options.template.contentTransform === 'function') {
        try {
          content = options.template.contentTransform(content);
        } catch (transformError) {
          console.error(`[Ebook Generator] Error in template transformation: ${transformError.message}`);
          // Continue with original content if transformation fails
        }
      }
      htmlContent = preprocessHtmlForKindle(content);
    } else if (format === 'markdown') {
      const marked = require('marked');
      marked.setOptions({
        headerIds: false,
        mangle: false,
        breaks: true,
        sanitize: false
      });
      htmlContent = marked.parse(content);
    } else {
      htmlContent = `<div>${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }

    // Use newsletter-specific template if available
    const customCss = options.template?.cssTemplate || '';

    // Extract author from options if available
    const author = options.newsletterInfo?.from
      ? extractAuthorName(options.newsletterInfo.from)
      : 'Newsletter';

    // Generate EPUB
    const epubBuffer = await generateEPUB(title, author, htmlContent, customCss, options);

    // Get format preference
    const formatPreference = options.formatPreference || 'auto';

    // Try to convert to AZW3 using Calibre if available and requested
    if (formatPreference === 'auto' || formatPreference === 'azw3') {
      try {
        const hasCalibr = await checkCalibreAvailable();
        if (hasCalibr) {
          console.log(`[Ebook Generator] Calibre found, converting EPUB to AZW3`);
          const azw3Buffer = await convertWithCalibre(epubBuffer, 'epub', 'azw3');
          return { buffer: azw3Buffer, format: 'azw3' };
        } else {
          console.log(`[Ebook Generator] Calibre not found, using EPUB format`);
          return { buffer: epubBuffer, format: 'epub' };
        }
      } catch (conversionError) {
        console.error(`[Ebook Generator] Error converting to AZW3: ${conversionError.message}`);
        // When auto, we fall back to EPUB on error
        // When specifically AZW3 is requested, we should still warn but fall back
        console.log(`[Ebook Generator] Falling back to EPUB format`);
        return { buffer: epubBuffer, format: 'epub' };
      }
    } else {
      // User specifically requested EPUB
      console.log(`[Ebook Generator] User requested EPUB format`);
      return { buffer: epubBuffer, format: 'epub' };
    }
  } catch (error) {
    console.error(`[Ebook Generator] Error generating ebook: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Check if Calibre's ebook-convert tool is available
 * @returns {Promise<boolean>} - True if Calibre is available
 */
async function checkCalibreAvailable() {
  try {
    await execFile('ebook-convert', ['--version']);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a title page EPUB for the newsletter
 * @param {string} titleText - The title of the newsletter
 * @param {Object} options - Additional options
 * @returns {Promise<{buffer: Buffer, format: string}>} - Buffer containing the generated file and format type
 */
async function generateTitlePage(titleText, options = {}) {
  try {
    // Enhanced title page with newsletter type if available
    const subtitle = options.newsletterInfo ?
      `<p style="font-size: 18pt; color: #444; margin-top: 0.5in;">${options.newsletterInfo.name}</p>` : '';

    const dateText = options.date ?
      `<p style="font-size: 16pt; color: #555; margin-top: 0.5in; font-style: italic;">${options.date}</p>` : '';

    const htmlContent = `
      <div style="text-align: center; padding-top: 3in;">
        <h1 style="font-size: 28pt; margin: 0; line-height: 1.3;">${escapeHtml(titleText)}</h1>
        ${subtitle}
        ${dateText}
      </div>
    `;

    const author = options.newsletterInfo?.from
      ? extractAuthorName(options.newsletterInfo.from)
      : 'Newsletter';

    // Generate EPUB
    const epubBuffer = await generateEPUB(titleText, author, htmlContent, '', options);

    // Get format preference
    const formatPreference = options.formatPreference || 'auto';

    // Try to convert to AZW3 using Calibre if available and requested
    if (formatPreference === 'auto' || formatPreference === 'azw3') {
      try {
        const hasCalibr = await checkCalibreAvailable();
        if (hasCalibr) {
          console.log(`[Ebook Generator] Calibre found, converting title page to AZW3`);
          const azw3Buffer = await convertWithCalibre(epubBuffer, 'epub', 'azw3');
          return { buffer: azw3Buffer, format: 'azw3' };
        } else {
          console.log(`[Ebook Generator] Calibre not found, using EPUB format for title page`);
          return { buffer: epubBuffer, format: 'epub' };
        }
      } catch (conversionError) {
        console.error(`[Ebook Generator] Error converting title page to AZW3: ${conversionError.message}`);
        console.log(`[Ebook Generator] Falling back to EPUB format for title page`);
        return { buffer: epubBuffer, format: 'epub' };
      }
    } else {
      // User specifically requested EPUB
      return { buffer: epubBuffer, format: 'epub' };
    }
  } catch (error) {
    console.error(`[Ebook Generator] Error generating title page: ${error.message}`);
    throw error;
  }
}

/**
 * Generate EPUB from HTML content
 * @param {string} title - Title of the book
 * @param {string} author - Author of the book
 * @param {string} htmlContent - HTML content
 * @param {string} customCss - Custom CSS to be applied
 * @param {Object} options - Additional options
 * @returns {Promise<Buffer>} - Buffer containing the EPUB
 */
async function generateEPUB(title, author, htmlContent, customCss = '', options = {}) {
  // Create temp output directory and file
  const tempDir = temp.mkdirSync('epub-generation');
  const tempEpubPath = path.join(tempDir, `${sanitizeFilename(title)}.epub`);

  // Base CSS for Kindle optimization
  const baseKindleCss = `
    body {
      font-family: 'Bookerly', Georgia, 'Times New Roman', serif;
      font-size: 1em;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      color: #000;
    }

    .content-wrapper {
      margin: 0;
      padding: 0;
    }

    p {
      margin: 0.7em 0;
      text-indent: 1em;
      orphans: 2;
      widows: 2;
    }

    /* First paragraph after heading should not be indented */
    h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p {
      text-indent: 0;
    }

    /* Lists should not be indented */
    li p {
      text-indent: 0;
    }

    /* No indentation for blockquotes */
    blockquote p {
      text-indent: 0;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.4em;
      margin-bottom: 0.6em;
      line-height: 1.3;
      font-family: 'Bookerly', Georgia, serif;
    }

    h1 {
      font-size: 1.5em;
      text-align: center;
      margin-top: 1em;
      margin-bottom: 1em;
    }

    h2 {
      font-size: 1.3em;
      margin-top: 1.2em;
    }

    h3 {
      font-size: 1.2em;
    }

    h4 {
      font-size: 1.1em;
    }

    img {
      max-width: 100%;
      height: auto !important;
      display: block;
      margin: 1em auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 0.9em;
    }

    th, td {
      padding: 8px;
      border: 1px solid #ddd;
      vertical-align: top;
    }

    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }

    a {
      color: #000;
      text-decoration: underline;
    }

    blockquote {
      margin: 1em 1em;
      padding: 0.5em 1em;
      border-left: 3px solid #ddd;
      font-style: italic;
    }

    .kindle-meta {
      text-align: center;
      font-style: italic;
      color: #555;
      margin-bottom: 1.5em;
    }

    .figure {
      margin: 1.5em 0;
      text-align: center;
    }

    .image-caption {
      font-size: 0.9em;
      color: #555;
      font-style: italic;
      text-align: center;
      margin-top: 0.3em;
    }

    /* List styling */
    ul, ol {
      margin: 1em 0;
      padding: 0 0 0 1.2em;
    }

    li {
      margin-bottom: 0.5em;
    }

    /* Table of Contents Styles */
    .toc {
      margin: 1em 0;
    }

    .toc ol {
      padding-left: 1.5em;
    }

    .toc li {
      margin-bottom: 1em;
    }

    .toc-source {
      font-style: italic;
      font-size: 0.9em;
      color: #666;
      margin-left: 1em;
    }

    .toc-date {
      font-size: 0.9em;
      color: #666;
      margin-left: 1em;
    }

    .date {
      text-align: center;
      font-style: italic;
      color: #666;
      margin-bottom: 1.5em;
    }

    /* Enhanced TOC styling for multi-newsletter ebooks */
    .enhanced-toc {
      margin: 1.5em 0;
    }

    .enhanced-toc h1 {
      font-size: 1.6em;
      text-align: center;
      margin-bottom: 1em;
    }

    .enhanced-toc ol {
      list-style-type: decimal;
      margin-left: 1em;
    }

    .enhanced-toc li {
      margin-bottom: 1em;
    }

    .toc-title {
      font-weight: bold;
      font-size: 1.1em;
    }

    .toc-link {
      text-decoration: none;
      color: #0066cc;
    }

    .toc-meta {
      font-size: 0.9em;
      color: #666;
      margin-top: 0.3em;
    }
  `;

  // Combine base CSS with custom newsletter CSS
  const fullCss = baseKindleCss + customCss;

  // Newsletter meta information
  const metaSection = options.newsletterInfo ?
    `<div class="kindle-meta">
      ${options.newsletterInfo.date ? `<div>${options.newsletterInfo.date}</div>` : ''}
      ${options.newsletterInfo.from ? `<div>From: ${escapeHtml(options.newsletterInfo.from)}</div>` : ''}
     </div>` : '';

  // Build full HTML content
  const wrappedHtmlContent = `
    <div class="content-wrapper">
      ${metaSection}
      ${htmlContent}
    </div>
  `;

  // Configure options for epub-gen
  const epubOptions = {
    title: title,
    author: author,
    content: [
      {
        title: title,
        data: wrappedHtmlContent,
      }
    ],
    customHtmlHeaders: `<style>${fullCss}</style>`,
    output: tempEpubPath,
    verbose: false,
    version: 3, // EPUB3 format
    customOpfMetadata: `
      <meta property="rendition:layout">reflowable</meta>
      <meta property="rendition:spread">auto</meta>
    `,
  };

  // If this is a table of contents, add the nav property
  if (options.isTableOfContents) {
    epubOptions.content[0].beforeToc = false; // Make sure TOC appears in content
    epubOptions.content[0].excludeFromToc = false;
    epubOptions.content[0].data = `<nav epub:type="toc" id="toc">${wrappedHtmlContent}</nav>`;
  }

  // Add cover if available in options
  if (options.coverPath) {
    epubOptions.cover = options.coverPath;
  }

  try {
    // Create the EPUB file
    await new Promise((resolve, reject) => {
      new epub(epubOptions).promise
        .then(() => resolve())
        .catch(err => reject(err));
    });

    // Read the EPUB file to a buffer
    const epubBuffer = fs.readFileSync(tempEpubPath);

    return epubBuffer;
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[Ebook Generator] Failed to clean up temp directory: ${err.message}`);
    }
  }
}

/**
 * Convert ebook from one format to another using Calibre
 * @param {Buffer} inputBuffer - Input file buffer
 * @param {string} inputFormat - Input format (e.g., 'epub')
 * @param {string} outputFormat - Output format (e.g., 'azw3')
 * @returns {Promise<Buffer>} - Buffer containing the converted file
 */
async function convertWithCalibre(inputBuffer, inputFormat, outputFormat) {
  // Create temporary files for the conversion process
  const tempInputPath = temp.path({ suffix: `.${inputFormat}` });
  const tempOutputPath = tempInputPath.replace(`.${inputFormat}`, `.${outputFormat}`);

  try {
    // Write the input buffer to a temporary file
    fs.writeFileSync(tempInputPath, inputBuffer);

    // Convert using Calibre's ebook-convert
    await execFile('ebook-convert', [tempInputPath, tempOutputPath]);

    // Read the converted file
    return fs.readFileSync(tempOutputPath);
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch (e) {
      console.warn(`[Ebook Generator] Error cleaning up temp files: ${e.message}`);
    }
  }
}

/**
 * Process HTML to be more Kindle-friendly
 * @param {string} html - HTML content to process
 * @returns {string} - Processed HTML
 */
function preprocessHtmlForKindle(html) {
  if (!html) return '';

  try {
    let clean = html;

    // First, preserve image references by converting them to safe placeholders
    const imageReferences = [];
    clean = clean.replace(/<img([^>]+)>/gi, (match, attributes) => {
      // Extract src attribute
      const srcMatch = attributes.match(/src=["']([^"']+)["']/i);
      const src = srcMatch ? srcMatch[1] : '';

      // Extract alt attribute
      const altMatch = attributes.match(/alt=["']([^"']+)["']/i);
      const alt = altMatch ? altMatch[1] : 'Newsletter image';

      // Store original image tag and generate a placeholder
      const index = imageReferences.length;
      imageReferences.push({
        original: match,
        src: src,
        alt: alt
      });

      // Return a placeholder that we can find later
      return `<!-- IMAGE_PLACEHOLDER_${index} -->`;
    });

    // Remove HTML comments (except our image placeholders)
    clean = clean.replace(/<!--(?!IMAGE_PLACEHOLDER_)\s*[\s\S]*?-->/gi, '');

    // Remove inline styles, font tags, script, style
    clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
    clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/<font[^>]*>/gi, '');
    clean = clean.replace(/<\/font>/gi, '');

    // Keep some inline styles for alignment but remove others
    clean = clean.replace(/\sstyle="([^"]*)"/gi, (match, styles) => {
      // Only keep alignment, display, margin styles
      const keepStyles = styles.split(';')
        .filter(style => {
          const lowerStyle = style.toLowerCase().trim();
          return lowerStyle.startsWith('text-align') ||
                 lowerStyle.startsWith('display') ||
                 lowerStyle.startsWith('margin') ||
                 lowerStyle.startsWith('padding');
        })
        .join(';');

      return keepStyles ? ` style="${keepStyles}"` : '';
    });

    // Remove spacer tables, divs, spans with no text
    clean = clean.replace(/<table[^>]*>(\s|&nbsp;|<br>)*<\/table>/gi, '');
    clean = clean.replace(/<div[^>]*>(\s|&nbsp;|<br>)*<\/div>/gi, '');
    clean = clean.replace(/<span[^>]*>(\s|&nbsp;|<br>)*<\/span>/gi, '');

    // Handle tables for better Kindle display
    clean = clean.replace(/<table([^>]*)>/gi, (match, attrs) => {
      // If table has border attribute or class with "data", keep it as table
      if (attrs.includes('border') ||
          attrs.includes('class="data') ||
          attrs.includes('class="table')) {
        return `<table${attrs} style="width:100%; margin:1em 0; border-collapse:collapse;">`;
      } else {
        // Otherwise convert to div (likely layout table)
        return '<div style="width:100%; margin:0.5em 0;">';
      }
    });
    clean = clean.replace(/<\/table>/gi, (match) => {
      return '</div>';
    });

    // Better TR/TD handling
    clean = clean.replace(/<tr[^>]*>/gi, '<div style="margin:0.2em 0; display:flex; flex-wrap:wrap;">');
    clean = clean.replace(/<\/tr>/gi, '</div>');
    clean = clean.replace(/<td([^>]*)>/gi, '<div$1 style="flex:1; min-width:50%; padding:0.2em;">');
    clean = clean.replace(/<\/td>/gi, '</div>');

    // Remove full URLs unless they're linked
    clean = clean.replace(/https?:\/\/[^\s<>"']+/g, match => {
      return clean.includes(`href="${match}"`) ? match : '';
    });

    // Handle lists better
    clean = clean.replace(/<(ul|ol)([^>]*)>/gi, '<$1$2 style="margin-left:1em; padding-left:1em;">');

    // Improve blockquote appearance
    clean = clean.replace(/<blockquote([^>]*)>/gi, '<blockquote$1 style="margin:1em 0 1em 1em; padding-left:1em; border-left:3px solid #ccc; font-style:italic;">');

    // Now restore the image placeholders with properly formatted img tags
    imageReferences.forEach((image, index) => {
      const placeholder = `<!-- IMAGE_PLACEHOLDER_${index} -->`;
      if (image.src) {
        // Create an enhanced image tag with good Kindle formatting
        const enhancedImageTag = `<img src="${image.src}" alt="${image.alt}" style="max-width:100%; height:auto !important; display:block; margin:1em auto;">`;
        clean = clean.replace(placeholder, enhancedImageTag);
      } else {
        // If for some reason there's no src, remove the placeholder
        clean = clean.replace(placeholder, '');
      }
    });

    // Add first-paragraph class to first paragraph after headings
    clean = clean.replace(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)(\s*<p)/gi, '$1$2 class="first-paragraph"');

    // Replace multiple <br> tags with a single paragraph break
    clean = clean.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');

    // Create anchors for each heading to improve navigation
    clean = clean.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (match, level, content) => {
      // Create an id from the heading content
      const idText = content.replace(/<[^>]+>/g, '').trim() // Remove any HTML tags
                           .toLowerCase()
                           .replace(/[^\w\s-]/g, '') // Remove special characters
                           .replace(/\s+/g, '-'); // Replace spaces with hyphens

      // Create unique ID with a prefix to avoid duplicates
      const uniqueId = `heading-${level}-${idText.substring(0, 40)}`;

      return `<h${level} id="${uniqueId}">${content}</h${level}>`;
    });

    return clean;
  } catch (error) {
    console.error(`[Ebook Generator] Error preprocessing HTML: ${error.message}`);
    return html || ''; // Return original or empty string if null
  }
}

/**
 * Extract author name from email "from" field
 * @param {string} from - Email "from" field (e.g., "John Doe <john@example.com>")
 * @returns {string} - Author name
 */
function extractAuthorName(from) {
  if (!from) return 'Unknown';

  // Check if there's a name part (e.g., "John Doe <john@example.com>")
  const nameMatch = from.match(/^([^<]+)</);
  if (nameMatch && nameMatch[1].trim()) {
    return nameMatch[1].trim();
  }

  // If no name part, try to extract from the email address
  const emailMatch = from.match(/<([^>]+)>/);
  if (emailMatch && emailMatch[1]) {
    // Use the part before @ as the name
    const namePart = emailMatch[1].split('@')[0];
    // Convert something like "john.doe" to "John Doe"
    return namePart
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  // Just return the whole string if we can't parse it
  return from;
}

/**
 * Sanitize a string to use as a filename
 * @param {string} filename - The original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'newsletter';

  // Replace invalid characters with underscores
  return filename
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#039;');
}

module.exports = {
  generateEbook,
  generateTitlePage
};
