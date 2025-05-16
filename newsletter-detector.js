// utils/newsletter-detector.js
const fs = require('fs');
const path = require('path');

/**
 * Newsletter-specific templates for formatting emails for Kindle
 */
const NEWSLETTER_TEMPLATES = {
  // Stratechery template with improved image handling
  stratechery: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.7;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.3in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.2in;
        line-height: 1.2;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
      }
      p {
        margin: 0.8em 0;
        text-indent: 0.2in;
        text-align: justify;
      }
      /* Remove indentation for first paragraph after heading */
      h1 + p, h2 + p, h3 + p, .article-info + p,
      blockquote p, li p, .date + p {
        text-indent: 0;
      }
      blockquote {
        margin: 1em 1em;
        font-style: italic;
        border-left: 2px solid #666;
        padding-left: 0.5em;
      }
      blockquote p {
        text-indent: 0;
      }
      img {
        max-width: 95%;
        height: auto !important;
        margin: 0.3in auto;
        display: block;
      }
      .article-info {
        font-style: italic;
        text-align: center;
        margin-bottom: 0.3in;
        font-size: 12pt;
      }
      a {
        color: #000;
        text-decoration: underline;
      }
      .footnote {
        font-size: 10pt;
        color: #666;
        margin-top: 0.1in;
        line-height: 1.4;
      }
      .footnote p {
        text-indent: 0;
      }
      .date {
        text-align: center;
        font-style: italic;
        color: #666;
        margin-bottom: 0.2in;
        font-size: 12pt;
      }
      .figure {
        margin: 1em 0;
        text-align: center;
        page-break-inside: avoid;
      }
      .image-caption {
        font-size: 10pt;
        color: #666;
        font-style: italic;
        text-align: center;
        margin-top: 0.5em;
      }
      .newsletter-image {
        max-width: 95%;
        height: auto !important;
        margin: 1em auto;
        display: block;
        border: 1px solid #eee;
        background-color: #f9f9f9;
        padding: 4px;
      }
      table {
        width: 95%;
        margin: 1em auto;
        border-collapse: collapse;
      }
      th, td {
        padding: 0.5em;
        border: 1px solid #ddd;
        font-size: 11pt;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      let cleaned = html;

      // Find and collect all image references before other processing
      const imageRegex = /<img[^>]*src="([^"]*)"[^>]*>/gi;
      const images = [];
      let match;

      while ((match = imageRegex.exec(html)) !== null) {
        if (match[1] && !match[1].includes('spacer.gif') && !match[1].includes('tracking')) {
          images.push({
            src: match[1],
            full: match[0]
          });
        }
      }

      // Extract Stratechery main content
      const contentMatch = /<div[^>]*?class="?(?:post-content|entry-content)"?[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      if (contentMatch) {
        cleaned = contentMatch[1];
      }

      // Try to extract title and info
      const titleMatch = /<h1[^>]*?class="?(?:post-title|entry-title)"?[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
                        /<div[^>]*?class="?article-title"?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const title = titleMatch ? titleMatch[1] : 'Stratechery';

      // Extract article meta info
      const metaMatch = /<div[^>]*?class="?(?:post-meta|entry-meta)"?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const meta = metaMatch ? metaMatch[1] : '';

      // Extract date if available
      const dateMatch = /<time[^>]*?datetime="([^"]*)"[^>]*>([^<]*)<\/time>/i.exec(html) ||
                       /<div[^>]*?class="?date"?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const date = dateMatch ? `<div class="date">${dateMatch[2] || dateMatch[1] || dateMatch[0]}</div>` : '';

      // Handle "Newsletter image" references
      if (cleaned.includes('Newsletter image') && images.length > 0) {
        // For texts like "Newsletter image" or "[Newsletter image]", replace with actual images
        cleaned = cleaned.replace(/\[?Newsletter image\]?/gi, () => {
          // Get a random image from our collection
          const randomIndex = Math.floor(Math.random() * images.length);
          const img = images[randomIndex];
          return `<img src="${img.src}" alt="Newsletter image" class="newsletter-image">`;
        });
      }

      // Handle any missing images more aggressively to make sure we capture them
      cleaned = cleaned.replace(/\[Image:[^\]]+\]/gi, (match) => {
        if (images.length > 0) {
          // Get a random image from our collection
          const randomIndex = Math.floor(Math.random() * images.length);
          const img = images[randomIndex];
          return `<img src="${img.src}" alt="${match.substring(7, match.length-1)}" class="newsletter-image">`;
        }
        return match;
      });

      // Fix figure handling
      cleaned = cleaned.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match, content) => {
        const imgMatch = /<img[^>]*src="([^"]*)"[^>]*>/i.exec(content);
        const imgSrc = imgMatch ? imgMatch[1] : '';

        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(content);
        const caption = captionMatch ? captionMatch[1] : '';

        if (imgSrc) {
          return `
            <div class="figure">
              <img src="${imgSrc}" alt="${caption || 'Figure'}" class="newsletter-image">
              ${caption ? `<div class="image-caption">${caption}</div>` : ''}
            </div>
          `;
        }

        return match;
      });

      // Handle newsletter-specific image links with Markdown-style syntax
      cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/gi, (match, text, url) => {
        // Only convert image links
        if (url.match(/\.(jpe?g|png|gif|webp|svg)$/i)) {
          return `<img src="${url}" alt="${text}" class="newsletter-image">`;
        }
        return match;
      });

      // Improve image handling - retain all images with better formatting
      cleaned = cleaned.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => {
        // Skip tracking pixels and tiny images
        if (match.includes('width="1"') || match.includes('height="1"') ||
            match.includes('width=\'1\'') || match.includes('height=\'1\'')) {
          return '';
        }

        // Check if it's an image we want to keep
        if (src.includes('spacer.gif') ||
            src.includes('tracking') ||
            src.includes('pixel') ||
            src.includes('beacon')) {
          return '';
        }

        // Extract alt text if available
        const altMatch = match.match(/alt="([^"]*)"/i);
        const alt = altMatch ? altMatch[1] : 'Newsletter image';

        return `<img src="${src}" alt="${alt}" style="max-width:95%; height:auto !important; display:block; margin:0.5em auto;" class="newsletter-image">`;
      });

      // Rebuild with clean structure
      cleaned = `
        <h1>${title}</h1>
        ${date}
        ${meta ? `<div class="article-info">${meta}</div>` : ''}
        <div class="article-content">${cleaned}</div>
      `;

      // Improve footnotes formatting
      cleaned = cleaned.replace(/<div[^>]*?class="?footnote"?[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="footnote">$1</div>');

      // Remove common Stratechery elements that don't translate well to Kindle
      cleaned = cleaned.replace(/<div[^>]*?class="?(?:footer|comments|related|subscription)"?[^>]*>[\s\S]*?<\/div>/gi, '');

      return cleaned;
    }
  },

  // Substack template with improved image handling
  substack: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.6;
        margin: 0.5in;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.3in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.2in;
        line-height: 1.2;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.15in;
      }
      .subtitle, .byline {
        font-style: italic;
        margin-bottom: 0.2in;
        font-size: 14pt;
        text-align: center;
      }
      p {
        margin: 0.7em 0;
        text-indent: 0.2in;
        text-align: justify;
      }
      /* First paragraph after heading should not be indented */
      h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p,
      .byline + p, .subtitle + p {
        text-indent: 0;
      }
      blockquote {
        margin: 1em 1em;
        padding-left: 0.5em;
        border-left: 2px solid #666;
        font-style: italic;
      }
      blockquote p {
        text-indent: 0;
      }
      img {
        max-width: 95%;
        height: auto !important;
        margin: 1em auto;
        display: block;
      }
      a {
        color: #000;
        text-decoration: underline;
      }
      .post-header {
        margin-bottom: 1em;
      }
      .post-content {
        margin-top: 0.5em;
      }
      table {
        width: 95%;
        margin: 1em auto;
        border-collapse: collapse;
      }
      th, td {
        padding: 0.5em;
        border: 1px solid #ddd;
        font-size: 11pt;
      }
      .footer, .unsubscribe, .social {
        display: none;
      }
      .figure {
        margin: 1em 0;
        page-break-inside: avoid;
      }
      figcaption, .image-caption {
        font-size: 10pt;
        color: #666;
        text-align: center;
        font-style: italic;
        margin-top: 0.3em;
      }
    `,
    contentTransform: (html) => {
      // Extract and clean up Substack specific elements
      if (!html) return '';

      // First collect all image references
      const imageRegex = /<img[^>]*src="([^"]*)"[^>]*>/gi;
      const images = [];
      let match;

      while ((match = imageRegex.exec(html)) !== null) {
        if (match[1] && !match[1].includes('spacer.gif') && !match[1].includes('tracking')) {
          images.push({
            src: match[1],
            full: match[0]
          });
        }
      }

      let cleaned = html;

      // Move post-header to the top if possible
      const headerMatch = /<div[^>]*class="?post-header"?[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      const headerContent = headerMatch ? headerMatch[1] : '';

      // Extract main content
      const contentMatch = /<div[^>]*class="?post-content"?[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      const mainContent = contentMatch ? contentMatch[1] : cleaned;

      // If we found structured content
      if (headerContent && mainContent) {
        cleaned = `
          <div class="kindle-header">${headerContent}</div>
          <div class="kindle-content">${mainContent}</div>
        `;
      }

      // Clean up common Substack elements
      cleaned = cleaned.replace(/<div[^>]*?class="?(?:footer|social|subscribe-prompt|comments-prompt)"?[^>]*>[\s\S]*?<\/div>/gi, '');

      // Improve image handling - retain all images with better formatting
      cleaned = cleaned.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (match, src) => {
        // Skip tracking pixels and tiny images
        if (match.includes('width="1"') || match.includes('height="1"') ||
            match.includes('width=\'1\'') || match.includes('height=\'1\'')) {
          return '';
        }

        // Check if it's an image we want to keep
        if (src.includes('spacer.gif') ||
            src.includes('tracking') ||
            src.includes('pixel') ||
            src.includes('beacon')) {
          return '';
        }

        // Extract alt text if available
        const altMatch = match.match(/alt="([^"]*)"/i);
        const alt = altMatch ? altMatch[1] : 'Newsletter image';

        return `<img src="${src}" alt="${alt}" style="max-width:95%; height:auto !important; display:block; margin:0.5em auto;">`;
      });

      // Handle "Newsletter image" text or placeholders
      if (cleaned.includes('Newsletter image') && images.length > 0) {
        cleaned = cleaned.replace(/\[?Newsletter image\]?/gi, () => {
          // Get a random image from our collection
          const randomIndex = Math.floor(Math.random() * images.length);
          const img = images[randomIndex];
          return `<img src="${img.src}" alt="Newsletter image" style="max-width:95%; height:auto !important; display:block; margin:0.5em auto;">`;
        });
      }

      // Improve headings with hierarchical structure
      cleaned = cleaned.replace(/<h3[^>]*style="[^"]*">([^<]+)<\/h3>/gi, (match, content) => {
        // Check if it looks like a subtitle
        if (content.length < 100 && !content.includes('.')) {
          return `<h2>${content}</h2>`;
        }
        return match;
      });

      // Improve figure handling
      cleaned = cleaned.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match, content) => {
        const imgMatch = /<img[^>]*src="([^"]*)"[^>]*>/i.exec(content);
        const imgSrc = imgMatch ? imgMatch[1] : '';

        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(content);
        const caption = captionMatch ? captionMatch[1] : '';

        if (imgSrc) {
          return `
            <div class="figure">
              <img src="${imgSrc}" alt="${caption || 'Figure'}" style="max-width:95%; height:auto !important; display:block; margin:0.5em auto;">
              ${caption ? `<div class="image-caption">${caption}</div>` : ''}
            </div>
          `;
        }

        return match;
      });

      return cleaned;
    }
  },

  // NEW: Axios template for precise formatting
  axios: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.5;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.2in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.1in;
        line-height: 1.2;
        border-bottom: 1px solid #ccc;
        padding-bottom: 0.05in;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
        font-weight: bold;
      }
      .bullet-point {
        font-weight: bold;
        color: #444;
      }
      p {
        margin: 0.6em 0;
        text-indent: 0;
      }
      ul, ol {
        margin-top: 0.1in;
        margin-bottom: 0.2in;
      }
      li {
        margin-bottom: 0.1in;
      }
      img {
        max-width: 95%;
        height: auto !important;
        margin: 0.2in auto;
        display: block;
      }
      .byline {
        font-style: italic;
        text-align: center;
        margin-bottom: 0.2in;
        font-size: 11pt;
        color: #555;
      }
      .axios-section {
        margin-top: 0.3in;
        margin-bottom: 0.3in;
      }
      .axios-highlight {
        background-color: #f2f2f2;
        padding: 0.1in;
        margin: 0.1in 0;
        border-left: 3px solid #888;
      }
      .quote {
        font-style: italic;
        margin: 0.2in 0.3in;
        padding-left: 0.1in;
        border-left: 2px solid #888;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      let cleaned = html;

      // Extract Axios content sections
      const contentMatches = cleaned.match(/<div[^>]*?class="[^"]*?story[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi);
      if (contentMatches && contentMatches.length > 0) {
        cleaned = contentMatches.join('\n');
      }

      // Extract title
      const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
                        /<div[^>]*?class="[^"]*?headline[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const title = titleMatch ? titleMatch[1] : 'Axios Newsletter';

      // Format bullet points which are common in Axios
      cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (match, content) => {
        if (content.length < 150) { // Likely a bullet point, not a list item
          return `<p><span class="bullet-point">•</span> ${content}</p>`;
        }
        return match;
      });

      // Clean up divs that act as sections and replace with semantic HTML
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?content-block[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="axios-section">$1</div>');

      // Handle "Go deeper" sections
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?go-deeper[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="axios-highlight">$1</div>');

      // Improve quotes that are common in Axios
      cleaned = cleaned.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
        '<div class="quote">$1</div>');

      // Build final structure
      cleaned = `
        <h1>${title}</h1>
        <div class="byline">Axios</div>
        <div class="axios-content">${cleaned}</div>
      `;

      return cleaned;
    }
  },

  // NEW: Bulletin Media template
  bulletinmedia: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.5;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.3in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.1in;
        border-bottom: 1px solid #ccc;
        padding-bottom: 5px;
      }
      h3 {
        font-size: 16pt;
        font-weight: bold;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
      }
      p {
        margin: 0.7em 0;
        text-indent: 0;
      }
      .bulletin-section {
        margin-bottom: 0.3in;
      }
      .bulletin-headline {
        font-weight: bold;
        margin-bottom: 0.1in;
      }
      .bulletin-brief {
        margin-left: 0.2in;
      }
      .bulletin-source {
        font-style: italic;
        font-size: 10pt;
        color: #666;
        margin-top: 0.05in;
      }
      .bulletin-date {
        text-align: center;
        font-style: italic;
        margin-bottom: 0.2in;
      }
      .bulletin-category {
        background-color: #f5f5f5;
        padding: 0.05in;
        margin-top: 0.2in;
        font-weight: bold;
        text-transform: uppercase;
        font-size: 11pt;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      let cleaned = html;

      // Extract the main content
      const contentMatch = /<div[^>]*?id="?content"?[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned) ||
                         /<div[^>]*?class="?content"?[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      if (contentMatch) {
        cleaned = contentMatch[1];
      }

      // Extract title and date
      const titleMatch = /<div[^>]*?class="?headline"?[^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
                        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const title = titleMatch ? titleMatch[1] : 'Bulletin Media Newsletter';

      const dateMatch = /<div[^>]*?class="?date"?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const date = dateMatch ? `<div class="bulletin-date">${dateMatch[1]}</div>` : '';

      // Format news section categories
      cleaned = cleaned.replace(/<div[^>]*?class="?category"?[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="bulletin-category">$1</div>');

      // Format news headlines and briefs
      cleaned = cleaned.replace(/<div[^>]*?class="?headline"?[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*?class="?brief"?[^>]*>([\s\S]*?)<\/div>/gi,
        (match, headline, brief) => {
          return `
            <div class="bulletin-section">
              <div class="bulletin-headline">${headline}</div>
              <div class="bulletin-brief">${brief}</div>
            </div>
          `;
        });

      // Handle source citations that are common in Bulletin Media
      cleaned = cleaned.replace(/<div[^>]*?class="?source"?[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="bulletin-source">$1</div>');

      // Build final structure
      cleaned = `
        <h1>${title}</h1>
        ${date}
        <div class="bulletin-content">${cleaned}</div>
      `;

      return cleaned;
    }
  },

  // NEW: OneTech/Phillip newsletter template
  onetech: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.6;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.3in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.2in;
        color: #444;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
      }
      p {
        margin: 0.7em 0;
        text-indent: 0.2in;
      }
      /* Remove indentation for first paragraph after heading */
      h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p {
        text-indent: 0;
      }
      img {
        max-width: 95%;
        height: auto !important;
        margin: 1em auto;
        display: block;
      }
      .ot-section {
        margin: 0.3in 0;
        padding-bottom: 0.1in;
        border-bottom: 1px solid #eee;
      }
      .ot-highlight {
        background-color: #f5f5f5;
        padding: 0.1in;
        margin: 0.2in 0;
        border-left: 3px solid #888;
      }
      .ot-author {
        text-align: center;
        font-style: italic;
        margin-bottom: 0.2in;
      }
      table {
        width: 95%;
        margin: 0.2in auto;
        border-collapse: collapse;
      }
      th, td {
        padding: 0.1in;
        border: 1px solid #ddd;
      }
      th {
        background-color: #f5f5f5;
        font-weight: bold;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      let cleaned = html;

      // Extract main content
      const contentMatch = /<div[^>]*?class="[^"]*?content[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      if (contentMatch) {
        cleaned = contentMatch[1];
      }

      // Extract title and author
      const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
                        /<div[^>]*?class="[^"]*?title[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const title = titleMatch ? titleMatch[1] : 'OneTech Newsletter';

      const authorMatch = /<div[^>]*?class="[^"]*?author[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const author = authorMatch ? `<div class="ot-author">${authorMatch[1]}</div>` : '';

      // Format content sections
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?section[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="ot-section">$1</div>');

      // Format highlights
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?highlight[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="ot-highlight">$1</div>');

      // Improve table formatting
      cleaned = cleaned.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
        // Only process if it looks like a data table
        if (tableContent.includes('<th') || (tableContent.match(/<td/gi) || []).length > 4) {
          return `<table style="width:95%; margin:0.2in auto; border-collapse:collapse;">${tableContent}</table>`;
        }
        return match;
      });

      // Build final structure
      cleaned = `
        <h1>${title}</h1>
        ${author}
        <div class="onetech-content">${cleaned}</div>
      `;

      return cleaned;
    }
  },

  // NEW: JeffSelingo newsletter template
  jeffselingo: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.6;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.2in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.1in;
        color: #333;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
        font-weight: normal;
        font-style: italic;
      }
      p {
        margin: 0.7em 0;
        text-indent: 0.2in;
        text-align: justify;
      }
      /* First paragraph after heading should not be indented */
      h1 + p, h2 + p, h3 + p {
        text-indent: 0;
      }
      .js-section {
        margin: 0.3in 0;
        padding-bottom: 0.1in;
      }
      .js-summary {
        font-style: italic;
        margin: 0.2in 0;
        padding: 0.1in;
        border-left: 3px solid #888;
      }
      .js-quote {
        margin: 0.2in 1em;
        padding-left: 0.5em;
        border-left: 2px solid #888;
        font-style: italic;
      }
      .js-quote p {
        text-indent: 0;
      }
      .js-issue-number {
        text-align: center;
        font-style: italic;
        color: #555;
        margin-bottom: 0.2in;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      let cleaned = html;

      // Extract main content
      const contentMatch = /<div[^>]*?class="[^"]*?content-body[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned) ||
                         /<div[^>]*?class="[^"]*?main-content[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(cleaned);
      if (contentMatch) {
        cleaned = contentMatch[1];
      }

      // Extract title and issue number
      const titleMatch = /<div[^>]*?class="[^"]*?title[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
                        /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      const title = titleMatch ? titleMatch[1] : 'Jeff Selingo Newsletter';

      const issueMatch = /<div[^>]*?class="[^"]*?issue[^"]*?"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
      const issue = issueMatch ? `<div class="js-issue-number">${issueMatch[1]}</div>` : '';

      // Format sections
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?section[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="js-section">$1</div>');

      // Format summaries
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?summary[^"]*?"[^>]*>([\s\S]*?)<\/div>/gi,
        '<div class="js-summary">$1</div>');

      // Format quotes
      cleaned = cleaned.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
        '<div class="js-quote">$1</div>');

      // Handle bottom section
      cleaned = cleaned.replace(/<div[^>]*?class="[^"]*?bottom[^"]*?"[^>]*>[\s\S]*?<\/div>/gi, '');

      // Build final structure
      cleaned = `
        <h1>${title}</h1>
        ${issue}
        <div class="js-content">${cleaned}</div>
      `;

      return cleaned;
    }
  },

  // Generic template for any newsletter - improved image handling
  generic: {
    cssTemplate: `
      body {
        font-family: 'Bookerly', Georgia, serif;
        font-size: 12pt;
        line-height: 1.5;
      }
      h1 {
        font-size: 22pt;
        margin-bottom: 0.3in;
        text-align: center;
        line-height: 1.2;
      }
      h2 {
        font-size: 18pt;
        margin-top: 0.3in;
        margin-bottom: 0.2in;
        line-height: 1.2;
      }
      h3 {
        font-size: 16pt;
        margin-top: 0.2in;
        margin-bottom: 0.1in;
      }
      p {
        margin: 0.8em 0;
        text-indent: 0.2in;
        text-align: justify;
      }
      /* Remove indentation for first paragraph after heading */
      h1 + p, h2 + p, h3 + p, blockquote p, li p {
        text-indent: 0;
      }
      img {
        max-width: 95%;
        height: auto !important;
        margin: 0.2in auto;
        display: block;
      }
      a {
        color: #000;
        text-decoration: underline;
      }
      blockquote {
        margin: 0.2in 1em;
        padding-left: 0.5em;
        border-left: 2px solid #666;
        font-style: italic;
      }
      blockquote p {
        text-indent: 0;
      }
      table {
        width: 95%;
        margin: 1em auto;
        border-collapse: collapse;
      }
      th, td {
        padding: 0.5em;
        border: 1px solid #ddd;
        font-size: 11pt;
      }
      .figure {
        margin: 1em 0;
        text-align: center;
        page-break-inside: avoid;
      }
      .image-caption {
        font-size: 10pt;
        color: #666;
        font-style: italic;
        text-align: center;
        margin-top: 0.3em;
      }
      ul, ol {
        margin: 0.5em 0 0.5em 1em;
      }
      li {
        margin-bottom: 0.3em;
      }
    `,
    contentTransform: (html) => {
      if (!html) return '';

      // First collect all image references
      const imageRegex = /<img[^>]*src="([^"]*)"[^>]*>/gi;
      const images = [];
      let match;

      while ((match = imageRegex.exec(html)) !== null) {
        if (match[1] && !match[1].includes('spacer.gif') && !match[1].includes('tracking')) {
          images.push({
            src: match[1],
            full: match[0]
          });
        }
      }

      // Basic cleanup for generic newsletters
      let cleaned = html;

      // Remove common newsletter clutter
      cleaned = cleaned.replace(/<div[^>]*?(?:footer|unsubscribe|social-media|advertisement|banner|promo)[^>]*>[\s\S]*?<\/div>/gi, '');

      // Normalize headers - remove inline styles but preserve alignment
      cleaned = cleaned.replace(/<(h[1-6])[^>]*style="([^"]*)"[^>]*>/gi, (match, tag, styles) => {
        // Keep only alignment styles
        const alignStyle = styles.match(/text-align\s*:\s*([^;]+)/i);
        if (alignStyle) {
          return `<${tag} style="text-align:${alignStyle[1]};">`;
        }
        return `<${tag}>`;
      });

      // Fix spacing issues
      cleaned = cleaned.replace(/(<\/p>)(<p>)/gi, '$1\n$2');

      // Remove invisible elements
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

      return cleaned;
    }
  },
};

/**
 * List of newsletter identifying patterns to detect newsletter type
 */
const NEWSLETTER_PATTERNS = {
  // Substack newsletter patterns
  substack: {
    domains: ['substack.com', 'substackcdn.com'],
    senderPatterns: ['@substack.com'],
    bodyPatterns: [
      'Unsubscribe from this newsletter',
      'Subscribe now',
      'substack.com',
      'class="post-content"',
      'class="post-header"'
    ],
    subjectPatterns: [],
    headerPatterns: ['X-Mailer: Substack']
  },

  // Stratechery by Ben Thompson
  stratechery: {
    domains: ['stratechery.com'],
    senderPatterns: ['Stratechery', 'Ben Thompson', '@stratechery.com'],
    bodyPatterns: [
      'Stratechery',
      'stratechery.com',
      'Ben Thompson'
    ],
    subjectPatterns: ['Stratechery'],
    headerPatterns: []
  },

  // NEW: Axios newsletter patterns
  axios: {
    domains: ['axios.com'],
    senderPatterns: ['axios', '@axios.com', 'newsletter@axios.com'],
    bodyPatterns: [
      'axios',
      'axios.com',
      'class="story"',
      'go deeper',
      'axios newsletter'
    ],
    subjectPatterns: ['Axios'],
    headerPatterns: []
  },

  // NEW: Bulletin Media newsletter patterns
  bulletinmedia: {
    domains: ['bulletinmedia.com', 'bulletin.com'],
    senderPatterns: ['bulletin media', '@bulletinmedia.com', 'bulletin@'],
    bodyPatterns: [
      'bulletin media',
      'morning briefing',
      'summary of',
      'news briefs',
      'bulletin intelligence'
    ],
    subjectPatterns: ['Daily Briefing', 'Morning Briefing', 'News Summary'],
    headerPatterns: []
  },

  // NEW: OneTech/Phillip newsletter patterns
  onetech: {
    domains: ['onetech.com', '1tech.com', 'philliptech.com'],
    senderPatterns: ['onetech', 'one tech', 'phillip', '@onetech.com', '@philliptech.com'],
    bodyPatterns: [
      'onetech newsletter',
      'tech highlights',
      'weekly tech summary',
      'phillip\'s tech digest'
    ],
    subjectPatterns: ['OneTech', 'Tech Digest', 'Phillip\'s Tech'],
    headerPatterns: []
  },

  // NEW: Jeff Selingo newsletter patterns
  jeffselingo: {
    domains: ['jeffselingo.com', 'selingo.com'],
    senderPatterns: ['jeff selingo', 'selingo', '@jeffselingo.com'],
    bodyPatterns: [
      'jeff selingo',
      'higher education',
      'college admissions',
      'university trends',
      'next newsletter'
    ],
    subjectPatterns: ['Jeff Selingo', 'Higher Ed', 'College'],
    headerPatterns: []
  }
};

/**
 * Detect the type of newsletter based on content and metadata
 * @param {Object} content - The newsletter content with html, text, subject, from
 * @returns {Object} - The detected newsletter type, name, and confidence
 */
function detectNewsletterType(content) {
  try {
    if (!content) {
      return { type: 'generic', name: 'Newsletter', confidence: 0 };
    }

    const { html, text, subject, from } = content;
    let bestMatch = { type: 'generic', name: 'Newsletter', confidence: 0 };

    // Extract domain from from field if available
    let fromDomain = '';
    const emailMatch = from && from.match(/@([^>]+)/);
    if (emailMatch && emailMatch[1]) {
      fromDomain = emailMatch[1].toLowerCase();
    }

    // Content to search in
    const searchableContent = [
      subject || '',
      from || '',
      text ? text.substring(0, 5000) : '', // Limit text to first 5000 chars for performance
    ].join(' ');

    // Score each newsletter type
    for (const [type, patterns] of Object.entries(NEWSLETTER_PATTERNS)) {
      let score = 0;
      const { domains, senderPatterns, bodyPatterns, subjectPatterns } = patterns;

      // Check domain in from field
      if (fromDomain && domains.some(domain => fromDomain.includes(domain))) {
        score += 5;
      }

      // Check sender patterns
      if (from) {
        for (const pattern of senderPatterns) {
          if (from.toLowerCase().includes(pattern.toLowerCase())) {
            score += 3;
          }
        }
      }

      // Check subject patterns
      if (subject) {
        for (const pattern of subjectPatterns) {
          if (subject.toLowerCase().includes(pattern.toLowerCase())) {
            score += 2;
          }
        }
      }

      // Check for patterns in body
      if (searchableContent) {
        for (const pattern of bodyPatterns) {
          if (searchableContent.toLowerCase().includes(pattern.toLowerCase())) {
            score += 1;
          }
        }
      }

      // Check HTML for specific patterns
      if (html) {
        const htmlSample = html.substring(0, 10000); // Limit to first 10000 chars
        for (const pattern of bodyPatterns) {
          if (htmlSample.toLowerCase().includes(pattern.toLowerCase())) {
            score += 1;
          }
        }

        // Check for specific CSS classes or structure patterns that would indicate this newsletter type
        if (type === 'substack' &&
           (htmlSample.includes('post-content') || htmlSample.includes('post-header'))) {
          score += 3;
        }

        if (type === 'stratechery' &&
           (htmlSample.includes('entry-content') || htmlSample.includes('post-body'))) {
          score += 3;
        }

        // Additional pattern checks for new newsletter types
        if (type === 'axios' &&
           (htmlSample.includes('class="story"') || htmlSample.includes('go deeper'))) {
          score += 3;
        }

        if (type === 'bulletinmedia' &&
           (htmlSample.includes('class="headline"') || htmlSample.includes('class="brief"'))) {
          score += 3;
        }

        if (type === 'onetech' &&
           (htmlSample.includes('tech digest') || htmlSample.includes('onetech newsletter'))) {
          score += 3;
        }

        if (type === 'jeffselingo' &&
           (htmlSample.includes('jeff selingo') || htmlSample.includes('higher education'))) {
          score += 3;
        }
      }

      // Normalize score as confidence (0-100)
      const confidence = Math.min(100, score * 10);

      // If this is the best match so far, update
      if (confidence > bestMatch.confidence) {
        bestMatch = {
          type,
          name: getNewsletterName(type, subject),
          confidence
        };
      }
    }

    return bestMatch;
  } catch (error) {
    console.error(`Error detecting newsletter type: ${error.message}`);
    return { type: 'generic', name: 'Newsletter', confidence: 0 };
  }
}

/**
 * Get a friendly newsletter name based on type and subject
 * @param {string} type - The detected newsletter type
 * @param {string} subject - The email subject
 * @returns {string} - A friendly newsletter name
 */
function getNewsletterName(type, subject) {
  switch(type) {
    case 'substack':
      // Try to extract the newsletter name from subject
      const substackMatch = subject && subject.match(/(.+?) - /);
      return substackMatch ? substackMatch[1] : 'Substack Newsletter';

    case 'stratechery':
      return 'Stratechery';

    case 'axios':
      return 'Axios Newsletter';

    case 'bulletinmedia':
      return 'Bulletin Media Briefing';

    case 'onetech':
      return 'OneTech Newsletter';

    case 'jeffselingo':
      return 'Jeff Selingo Newsletter';

    default:
      // Try to extract a newsletter name from the subject
      if (subject) {
        // If subject has a colon, use the part before it
        if (subject.includes(':')) {
          return subject.split(':')[0];
        }

        // If subject has a dash, use the part before it
        if (subject.includes(' - ')) {
          return subject.split(' - ')[0];
        }

        // Otherwise use the whole subject if it's not too long
        if (subject.length < 40) {
          return subject;
        }
      }

      return 'Newsletter';
  }
}

/**
 * Get the template for a specific newsletter type
 * @param {string} type - The newsletter type
 * @returns {Object} - The template object with cssTemplate and contentTransform
 */
function getNewsletterTemplate(type) {
  // Return the specified template or fallback to generic
  return NEWSLETTER_TEMPLATES[type] || NEWSLETTER_TEMPLATES.generic;
}

module.exports = {
  detectNewsletterType,
  getNewsletterTemplate,
  getNewsletterName,
  NEWSLETTER_TEMPLATES,
  NEWSLETTER_PATTERNS
};
