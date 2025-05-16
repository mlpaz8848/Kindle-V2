const puppeteer = require('puppeteer');
const marked = require('marked');
const TurndownService = require('turndown');
const fs = require('fs');
const path = require('path');
const os = require('os');

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

marked.setOptions({
  headerIds: false,
  mangle: false,
  breaks: true,
  sanitize: false
});

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#039;');
}

async function generatePDF(title, content, format, options = {}) {
  let browser = null;

  try {
    console.log(`[PDF Generator] Starting PDF generation for: ${title}`);

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
          console.error(`[PDF Generator] Error in template transformation: ${transformError.message}`);
          // Continue with original content if transformation fails
        }
      }
      htmlContent = preprocessHtmlForKindle(content);
    } else if (format === 'markdown') {
      htmlContent = marked.parse(content);
    } else {
      htmlContent = `<div>${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }

    // Use newsletter-specific template if available
    const customCss = options.template?.cssTemplate || '';
    const fullHtml = generateKindleTemplate(title, htmlContent, customCss, options.newsletterInfo);

    // Generate PDF with newsletter-specific options
    return await generatePdfWithPuppeteer(fullHtml, options);
  } catch (error) {
    console.error(`[PDF Generator] Error generating PDF: ${error.message}`);
    console.error(error.stack);

    // Create a minimal error PDF if possible
    try {
      const errorHtml = `
        <html>
        <head>
          <style>
            @font-face {
              font-family: 'Bookerly-Fallback';
              src: local('Georgia'), local('Times New Roman'), local('serif');
              font-weight: normal;
              font-style: normal;
            }
            body {
              font-family: 'Bookerly-Fallback', Georgia, serif;
              margin: 40px;
              font-size: 12pt;
            }
            h1 { color: #d32f2f; font-size: 18pt; }
            pre { background: #f5f5f5; padding: 10px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Error Processing Newsletter</h1>
          <p>There was an error generating the PDF for "${escapeHtml(title)}":</p>
          <pre>${escapeHtml(error.message)}</pre>
          <p>Please try again with a different file.</p>
        </body>
        </html>
      `;

      // Try to generate a minimal error PDF
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(errorHtml, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await page.pdf({
        width: '6in',
        height: '9in',
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });

      return pdfBuffer;
    } catch (secondaryError) {
      console.error(`[PDF Generator] Error generating error PDF: ${secondaryError.message}`);
      throw error; // Throw the original error if we can't even create an error PDF
    } finally {
      if (browser) await browser.close();
    }
  }
}

async function generateTitlePage(titleText, options = {}) {
  let browser = null;

  try {
    // Enhanced title page with newsletter type if available
    const subtitle = options.newsletterInfo ?
      `<p style="font-size: 18pt; color: #444; margin-top: 0.5in;">${options.newsletterInfo.name}</p>` : '';

    const dateText = options.date ?
      `<p style="font-size: 16pt; color: #555; margin-top: 0.5in; font-style: italic;">${options.date}</p>` : '';

    const html = `
      <html>
      <head>
        <style>
          @font-face {
            font-family: 'Bookerly-Fallback';
            src: local('Georgia'), local('Times New Roman'), local('serif');
            font-weight: normal;
            font-style: normal;
          }
          body {
            font-family: 'Bookerly-Fallback', Georgia, serif;
            font-size: 18pt;
            text-align: center;
            padding-top: 3in;
            line-height: 1.4;
          }
          h1 {
            font-size: 28pt;
            margin: 0;
            line-height: 1.3;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(titleText)}</h1>
        ${subtitle}
        ${dateText}
      </body>
      </html>
    `;

    return await generatePdfWithPuppeteer(html, {
      // Force specific page size for title page
      pageSize: {
        width: '6in',
        height: '9in'
      }
    });
  } catch (error) {
    console.error(`[PDF Generator] Error generating title page: ${error.message}`);

    // Create a minimal title page on error
    try {
      const errorHtml = `
        <html>
        <head>
          <style>
            @font-face {
              font-family: 'Bookerly-Fallback';
              src: local('Georgia'), local('Times New Roman'), local('serif');
              font-weight: normal;
              font-style: normal;
            }
            body {
              font-family: 'Bookerly-Fallback', Georgia, serif;
              font-size: 18pt;
              text-align: center;
              padding-top: 3in;
            }
            h1 { font-size: 28pt; margin: 0; line-height: 1.3; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(titleText)}</h1>
        </body>
        </html>
      `;

      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(errorHtml, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await page.pdf({
        width: '6in',
        height: '9in',
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        }
      });

      return pdfBuffer;
    } catch (secondaryError) {
      console.error(`[PDF Generator] Error generating simple title page: ${secondaryError.message}`);
      throw error; // Throw the original error if we can't even create a simple title page
    } finally {
      if (browser) await browser.close();
    }
  }
}

function generateKindleTemplate(title, htmlContent, customCss = '', newsletterInfo = null) {
  // Base CSS for Kindle optimization
  const baseKindleCss = `
    @font-face {
      font-family: 'Bookerly-Fallback';
      src: local('Georgia'), local('Times New Roman'), local('serif');
      font-weight: normal;
      font-style: normal;
    }

    body {
      font-family: 'Bookerly-Fallback', Georgia, 'Times New Roman', serif;
      font-size: 12pt;
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
      text-indent: 0.2in; /* 5mm paragraph indentation */
      orphans: 2;
      widows: 2;
      font-size: 12pt;
      line-height: 1.5;
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
      page-break-after: avoid;
      font-family: 'Bookerly-Fallback', Georgia, serif;
    }

    h1 {
      font-size: 22pt;
      text-align: center;
      margin-top: 1em;
      margin-bottom: 1em;
    }

    h2 {
      font-size: 18pt;
      margin-top: 1.2em;
    }

    h3 {
      font-size: 16pt;
    }

    h4 {
      font-size: 14pt;
    }

    img {
      max-width: 100%;
      height: auto !important;
      display: block;
      margin: 1em auto;
      page-break-inside: avoid;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      page-break-inside: avoid;
      font-size: 10pt;
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
      page-break-inside: avoid;
    }

    .kindle-meta {
      text-align: center;
      font-style: italic;
      color: #555;
      margin-bottom: 1.5em;
      font-size: 12pt;
    }

    .unsubscribe, .footer, .header, [class*="promo"], [class*="advert"], [class*="ad-"], .banner {
      display: none !important;
    }

    .figure {
      margin: 1.5em 0;
      text-align: center;
      page-break-inside: avoid;
    }

    .image-caption {
      font-size: 10pt;
      color: #555;
      font-style: italic;
      text-align: center;
      margin-top: 0.3em;
    }

    .newsletter-image {
      max-width: 95%;
      height: auto !important;
      margin: 1em auto;
      display: block;
      border: 1px solid #eee;
      background-color: #f9f9f9;
      padding: 4px;
      page-break-inside: avoid;
    }

    /* List styling */
    ul, ol {
      margin: 1em 0;
      padding: 0 0 0 1.2em;
    }

    li {
      margin-bottom: 0.5em;
      page-break-inside: avoid;
    }

    /* Fix for empty paragraphs */
    p:empty {
      display: none;
    }

    /* Special case for first paragraph after title */
    .first-paragraph {
      text-indent: 0;
      margin-top: 1em;
    }

    /* Page breaks */
    .page-break {
      page-break-after: always;
      height: 0;
      margin: 0;
      border: 0;
    }
  `;

  // Newsletter meta information
  const metaSection = newsletterInfo ?
    `<div class="kindle-meta">
      ${newsletterInfo.date ? `<div>${newsletterInfo.date}</div>` : ''}
      ${newsletterInfo.from ? `<div>From: ${escapeHtml(newsletterInfo.from)}</div>` : ''}
     </div>` : '';

  // Combine base CSS with custom newsletter CSS
  const finalCss = baseKindleCss + customCss;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(title)}</title>
      <style>
        ${finalCss}
      </style>
    </head>
    <body>
      <div class="content-wrapper">
        <h1>${escapeHtml(title)}</h1>
        ${metaSection}
        ${htmlContent}
      </div>
    </body>
    </html>
  `;
}

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

    // Normalize heading styles
    for (let i = 1; i <= 6; i++) {
      const fontSize = 22 - (i * 2); // h1:22pt, h2:20pt, h3:18pt, etc.
      clean = clean.replace(new RegExp(`<h${i}([^>]*)>`, 'gi'),
        `<h${i}$1 style="font-size:${fontSize}pt; margin-top:1em; margin-bottom:0.5em; line-height:1.3;">`);
    }

    // Fix figure handling
    clean = clean.replace(/<figure([^>]*)>([\s\S]*?)<\/figure>/gi, (match, attrs, content) => {
      // Extract the image from the figure content
      const imgMatch = /<img[^>]*>/i.exec(content);
      const img = imgMatch ? imgMatch[0] : '';

      // Extract the caption if any
      const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(content);
      const caption = captionMatch ? captionMatch[1] : '';

      return `
        <div class="figure" style="margin:1em 0; text-align:center;">
          ${img}
          ${caption ? `<div class="image-caption" style="font-size:10pt; text-align:center; font-style:italic; color:#555; margin-top:0.5em;">${caption}</div>` : ''}
        </div>
      `;
    });

    // Special handling for newsletter images
    clean = clean.replace(/Newsletter image/gi, match => {
      return `<!-- NEWSLETTER_IMAGE_REFERENCE -->`;
    });

    // Handle content-disposition: attachment images (base64 encoding needed)
    // This helps with images that are attachments and not displayed by default
    clean = clean.replace(/Content-Disposition:\s*attachment/gi, 'Content-Disposition: inline');

    // Now restore the image placeholders with properly formatted img tags
    imageReferences.forEach((image, index) => {
      const placeholder = `<!-- IMAGE_PLACEHOLDER_${index} -->`;
      if (image.src) {
        // Improve image handling for various protocols
        let imgSrc = image.src;

        // Handle data URIs better (they're already embedded)
        if (imgSrc.startsWith('data:')) {
          // Keep data URIs as they are
        }
        // Handle relative paths better
        else if (!imgSrc.match(/^https?:\/\//i) && !imgSrc.startsWith('cid:') && !imgSrc.startsWith('data:')) {
          // Try to convert to absolute path if possible
          // This is a simplification - in a real implementation, you'd need to handle base URLs properly
          imgSrc = `https://example.com/${imgSrc.replace(/^\//, '')}`;
        }

        // Handle CID references better (common in email)
        else if (imgSrc.startsWith('cid:')) {
          // These should have been processed earlier, but if we still have them here,
          // we'll keep them, and Puppeteer will likely just show a broken image
          console.log(`[PDF Generator] CID reference not preprocessed: ${imgSrc}`);
        }

        // Create an enhanced image tag with good Kindle formatting
        const enhancedImageTag = `<img src="${imgSrc}" alt="${image.alt}" style="max-width:100%; height:auto !important; display:block; margin:1em auto;">`;
        clean = clean.replace(placeholder, enhancedImageTag);
      } else {
        // If for some reason there's no src, remove the placeholder
        clean = clean.replace(placeholder, '');
      }
    });

    // Fix newsletter image references
    clean = clean.replace(/<!-- NEWSLETTER_IMAGE_REFERENCE -->/gi, '<img src="/assets/newsletter-placeholder.png" alt="Newsletter image" class="newsletter-image">');

    // Add first-paragraph class to first paragraph after headings
    clean = clean.replace(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)(\s*<p)/gi, '$1$2 class="first-paragraph"');

    // Replace multiple <br> tags with a single paragraph break
    clean = clean.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');

    // Fix for any remaining spacing issues
    clean = clean.replace(/(<\/p>)(\s*)(<p)/gi, '$1$2$3');

    return clean;
  } catch (error) {
    console.error(`[PDF Generator] Error preprocessing HTML: ${error.message}`);
    return html || ''; // Return original or empty string if null
  }
}

async function generatePdfWithPuppeteer(html, options = {}) {
  let browser;
  try {
    console.log('[PDF Generator] Starting PDF generation with Puppeteer');

    // Validate input
    if (!html || typeof html !== 'string') {
      throw new Error('Invalid HTML content provided for PDF generation');
    }

    // Add basic HTML structure if missing
    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
    }

    // Set a specific Chromium executable path for packaged app
    const chromiumExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
                                 (process.resourcesPath ?
                                  path.join(process.resourcesPath, 'puppeteer', '.local-chromium') :
                                  undefined);

    const puppeteerOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Helps with memory issues in Docker/CI environments
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--font-render-hinting=none', // Better font rendering
        '--disable-web-security', // Helps with loading cross-origin images
        '--allow-file-access-from-files' // Helps with local file access
      ]
    };

    // Only set executablePath if it exists to avoid errors
    if (chromiumExecutablePath && fs.existsSync(chromiumExecutablePath)) {
      puppeteerOptions.executablePath = chromiumExecutablePath;
      console.log(`[PDF Generator] Using Chromium at: ${chromiumExecutablePath}`);
    } else {
      console.log('[PDF Generator] Using default Chromium');
    }

    console.log(`[PDF Generator] Launching puppeteer with options: ${JSON.stringify(puppeteerOptions)}`);
    browser = await puppeteer.launch(puppeteerOptions);

    const page = await browser.newPage();

    // Log any page errors or console messages
    page.on('error', err => {
      console.error('[PDF Generator] Page error:', err);
    });

    page.on('console', msg => {
      console.log(`[PDF Generator] Page console [${msg.type()}]: ${msg.text()}`);
    });

    // Set viewport for better content handling
    await page.setViewport({ width: 600, height: 900 });

    // Add custom fonts for better rendering
    await page.evaluateOnNewDocument(() => {
      // Add fallback font styles
      const style = document.createElement('style');
      style.textContent = `
        @font-face {
          font-family: 'Bookerly-Fallback';
          src: local('Georgia'), local('Times New Roman'), local('serif');
          font-weight: normal;
          font-style: normal;
        }
        /* Use our fallback font */
        body {
          font-family: 'Bookerly-Fallback', Georgia, 'Times New Roman', serif !important;
        }
      `;
      document.head.appendChild(style);
    });

    // Enable better image loading and handling
    await page.setRequestInterception(true);

    page.on('request', request => {
      const resourceType = request.resourceType();
      // Log request details for debugging
      console.log(`[PDF Generator] Resource request: ${resourceType} - ${request.url().substring(0, 100)}`);

      if (resourceType === 'image') {
        // Check if it's a data URI (already embedded)
        if (request.url().startsWith('data:')) {
          request.continue();
          return;
        }

        // Check for potentially problematic URLs
        if (request.url().includes('cid:')) {
          console.warn(`[PDF Generator] Detected problematic CID URL: ${request.url()}`);
          // Let it continue anyway - we'll handle broken images later
          request.continue();
          return;
        }

        // Allow all other image requests to proceed
        request.continue();
      } else {
        request.continue();
      }
    });

    // Log any failed requests
    page.on('requestfailed', request => {
      console.error(`[PDF Generator] Request failed: ${request.url().substring(0, 100)} - ${request.failure().errorText}`);
    });

    console.log('[PDF Generator] Setting page content...');

    // Set a timeout for setContent to avoid hanging forever
    await page.setContent(html, {
      waitUntil: 'networkidle0', // Wait until network is idle (helps with images)
      timeout: 60000 // 60 second timeout
    });

    console.log('[PDF Generator] Page content set successfully, optimizing...');

    // Apply additional optimizations for Kindle paper reading
    await page.evaluate(() => {
      try {
        console.log('Starting page optimizations...');

        // Count elements for debugging
        const paragraphs = document.querySelectorAll('p').length;
        const images = document.querySelectorAll('img').length;
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;

        console.log(`Found ${paragraphs} paragraphs, ${images} images, ${headings} headings`);

        // Ensure paragraph spacing and avoid page breaks
        document.querySelectorAll('p').forEach((p, index) => {
          p.style.pageBreakInside = 'avoid';
          p.style.orphans = '2';
          p.style.widows = '2';
          p.style.marginBottom = '0.7em';

          // Add indentation to all paragraphs that don't have a class
          if (!p.classList.contains('first-paragraph') &&
              !p.closest('blockquote') &&
              !p.closest('li')) {
            p.style.textIndent = '0.2in';
          }

          // For debugging
          if (index < 3) {
            console.log(`Paragraph ${index+1} text: ${p.textContent.substring(0, 30)}...`);
          }
        });

        // Clean up excessive line breaks
        document.querySelectorAll('br').forEach((br, i, all) => {
          if (i > 0 && all[i - 1].tagName === 'BR') {
            br.remove();
          }
        });

        // Ensure good heading spacing
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
          h.style.pageBreakAfter = 'avoid';
          h.style.pageBreakBefore = 'auto';
          if (h.tagName === 'H1') {
            h.style.marginTop = '1em';
            h.style.marginBottom = '0.7em';
            console.log(`Main title: ${h.textContent}`);
          }
        });

        // Make sure images don't break across pages and handle broken images
        document.querySelectorAll('img').forEach((img, index) => {
          img.style.pageBreakInside = 'avoid';
          img.style.maxWidth = '95%';
          img.style.height = 'auto';
          img.style.display = 'block';
          img.style.margin = '1em auto';

          // Add image placeholders for broken images
          img.onerror = function() {
            console.log(`Image error for src: ${this.src.substring(0, 50)}...`);

            // Only replace if not already a data URL (avoid infinite loops)
            if (!this.src.startsWith('data:image')) {
              this.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAMAAAC8EZcfAAAAYFBMVEXd3d3///+ZmZnd3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d2ZmZl96PKbAAAAIHRSTlMAABAQECAgIDAwQEBAUFBgYHBwgICQkKCgsMDQ4ODw+GSuHIAAAAKESURBVHja7dDLbcMwFEXRJzmUZMWiQsrI5DH/RQ6QBRgimVc3i/ftA1xrxsxR9SMx2YJ4FsSwIJoFqS1IqKbWTQHSFTlI8xbJyDyXCc8i4nnwLNbZsmi5MV1e0sI5sc7vHiYTkT6EYywm+3OYjM7EJsNkNtngTGxDmwzOxDa0ydyYcIxJluVlLE8mlCUmEZ7kIfQ7JxSjnxXzXqbacEHfshEt7F8ZLoztiRiTtaH9ypB3+5RvH+TtPxlj8i2K302SZyIz3O5kC/tXhitDnoNMCt7IZMOwTNZGC8Nlj8mXMQ04qQEeGHAwYaVJDTxg0sJDC080FJ40wNJCeRjw1gN8pYOEoQP4Qg+FJw2wNND+CdASULgZmNCFAQ0NfGhgkwYYOkhYWCiIiIgLvd0wdPqUER/YNL1xuMDQ/0voAW8KIYR+jJHBUeEuIU21R9ge50IHUxnKUEPDsAGvGtioAR4YqGyUSQ1cGKphsIOOhtLQAEcNpTTwiAJv96TQwMHkpAG6MMDi0HB/Yo25hobtif1JDPCVgq3oAb7RwaIBvtKwLsqZbPwPYdgBMx0oiOYJGBF/DYMKtjHUSQ08NLDrQGVUAg8MLNDAJs6s0MCKB6SBFXoQPKCBFXpo8ID0gE8DHA20f8JeF/anMd98DPG62aXrH4a4PnHdh0f8MMS1w8zs0nFhGJ9NuNkQjp8xMzMz67pXlm2yVNJSVXUCEICZxXXiZmaZk5lZCiMzW2U4mVl1ZmbVmZm1yXNmtsrrbLbK62y2kltmVmBlljfr7gKQkBEQnGQABJCeIyBIlyEgM0dA5d7tyiIASzx/5F4Z6SVWBARaGQDZSkVGwEC+sjJARCoZAEEtA2BaGQC1MgCK0QiCYCSDoJYZUCuLaJVlRrRCZwG1AiDnFUByZlYWMTIQJQtJ9iISXkQqZFkEzVJEGiKVsixZStSMRaSULKVrUTKjyqjgxagwSu4FQT0AAAAASUVORK5CYII=';
              this.alt = 'Image could not be loaded';
              this.style.border = '1px dashed #ccc';
              this.style.padding = '10px';
              this.style.backgroundColor = '#f8f8f8';
            }
          };

          // Log a sample of image sources
          if (index < 3) {
            console.log(`Image ${index+1} src: ${img.src.substring(0, 50)}...`);
          }
        });

        // Ensure tables don't break across pages
        document.querySelectorAll('table').forEach(table => {
          table.style.pageBreakInside = 'avoid';
          table.style.width = '95%';
          table.style.margin = '1em auto';
          table.style.borderCollapse = 'collapse';
        });

        // Make sure figures don't break across pages
        document.querySelectorAll('.figure').forEach(figure => {
          figure.style.pageBreakInside = 'avoid';
        });

        // Improve list rendering
        document.querySelectorAll('ul, ol').forEach(list => {
          list.style.marginLeft = '1em';
          list.style.paddingLeft = '1em';
        });

        document.querySelectorAll('li').forEach(item => {
          item.style.marginBottom = '0.5em';
          item.style.pageBreakInside = 'avoid';
        });

        console.log('Page optimizations completed successfully');
      } catch (e) {
        console.error('Error in page.evaluate:', e);
      }
    });

    // Always use 6x9 standard page size for Kindle
    const pdfOptions = {
      width: '6in',
      height: '9in',
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      },
      printBackground: true,
      displayHeaderFooter: false,
      timeout: 60000 // 60 second timeout
    };

    // Override with any custom page size if specified
    if (options.pageSize) {
      if (typeof options.pageSize === 'object') {
        if (options.pageSize.width) pdfOptions.width = options.pageSize.width;
        if (options.pageSize.height) pdfOptions.height = options.pageSize.height;
      }
    }

    // Generate the PDF with proper options
    console.log(`[PDF Generator] Generating PDF with options: ${JSON.stringify(pdfOptions)}`);
    const pdfBuffer = await page.pdf(pdfOptions);

    console.log(`[PDF Generator] PDF generated successfully (${pdfBuffer.length} bytes)`);

    return pdfBuffer;
  } catch (error) {
    console.error(`[PDF Generator] Puppeteer error: ${error.message}`);
    console.error(error.stack);

    // Try to generate a very basic error PDF as fallback
    try {
      if (browser) {
        const page = await browser.newPage();
        await page.setContent(`
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; margin: 1in; line-height: 1.5; }
                h1 { color: #d32f2f; }
                pre { background: #f5f5f5; padding: 10px; white-space: pre-wrap; word-break: break-all; }
              </style>
            </head>
            <body>
              <h1>Error Generating PDF</h1>
              <p>There was an error creating the PDF:</p>
              <pre>${error.message}</pre>
              <p>Please try again with a different file or check the application logs for more details.</p>
            </body>
          </html>
        `);
        const errorPdf = await page.pdf({
          width: '6in',
          height: '9in',
          margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
        });

        console.log('[PDF Generator] Generated fallback error PDF');
        return errorPdf;
      }
    } catch (fallbackError) {
      console.error('[PDF Generator] Failed to generate fallback error PDF:', fallbackError);
    }

    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('[PDF Generator] Browser closed');
      } catch (closeError) {
        console.error(`[PDF Generator] Error closing browser: ${closeError.message}`);
      }
    }
  }
}

module.exports = {
  generatePDF,
  generateTitlePage
};
