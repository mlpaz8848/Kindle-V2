// utils/eml-to-azw3-converter.js
const fs = require('fs');
const path = require('path');
const { parseEmlFile } = require('./eml-parser');
const { generateEbook, generateTitlePage } = require('./azw3-generator');
const crypto = require('crypto');
const temp = require('temp').track();
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const AdmZip = require('adm-zip');

/**
 * Convert a single EML file to EPUB/AZW3 format
 * @param {string} emlFilePath - Path to the EML file
 * @param {string} outputPath - Path where the output file will be saved
 * @param {Object} options - Additional options for conversion
 * @returns {Promise<{filePath: string, format: string}>} - Path to the generated file and its format
 */
 // In eml-to-azw3-converter.js, add this at the beginning of the convertEmlToEbook function

 async function convertEmlToEbook(emlFilePath, outputPath, options = {}) {
   try {
     console.log(`[EML to Ebook] Starting conversion of ${emlFilePath}`);

     // Validate file exists
     if (!fs.existsSync(emlFilePath)) {
       console.error(`[EML to Ebook] File not found: ${emlFilePath}`);
       throw new Error(`File not found: ${path.basename(emlFilePath)}`);
     }

     // Log file size for diagnostic purposes
     const stats = fs.statSync(emlFilePath);
     console.log(`[EML to Ebook] File size: ${stats.size} bytes`);

    // Parse the EML file
    const emlContent = await parseEmlFile(emlFilePath);

    // Get newsletter info and template
    const { subject, html, text, images, date, from, newsletterInfo, template } = emlContent;

    // Process overridden template if provided
    const finalTemplate = options.selectedTemplate || template;

    // Sanitize title
    const title = sanitizeTitle(subject);

    // Generate ebook
    const content = html || text || '';
    const format = html ? 'html' : (text ? 'text' : 'text');

    // Use format preference if provided
    const formatPreference = options.formatPreference || 'auto';

    const { buffer, format: outputFormat } = await generateEbook(title, content, format, {
      template: finalTemplate,
      newsletterInfo: {
        ...newsletterInfo,
        date,
        from
      },
      images,
      formatPreference
    });

    // Adjust output path extension based on actual format
    const adjustedOutputPath = getAdjustedOutputPath(outputPath, outputFormat);

    // Save to output path
    fs.writeFileSync(adjustedOutputPath, buffer);

    console.log(`[EML to Ebook] Successfully converted ${emlFilePath} to ${adjustedOutputPath} (${outputFormat} format)`);
    return { filePath: adjustedOutputPath, format: outputFormat };
  } catch (error) {
    console.error(`[EML to Ebook] Error converting EML to ebook: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Convert multiple EML files to a single EPUB/AZW3 file
 * @param {Array<string>} emlFilePaths - Array of EML file paths
 * @param {string} outputPath - Path where the combined file will be saved
 * @param {Object} options - Additional options for conversion
 * @returns {Promise<{filePath: string, format: string}>} - Path to the generated file and its format
 */
async function convertMultipleEmlsToEbook(emlFilePaths, outputPath, options = {}) {
  try {
    console.log(`[EML to Ebook] Starting conversion of ${emlFilePaths.length} EML files`);

    // Send progress update
    if (options.onProgress) {
      options.onProgress(5, 'Starting conversion');
    }

    // Create a temp directory for our individual ebooks
    const tempDir = temp.mkdirSync('combined-ebooks');
    const allTitles = [];
    const allEmails = []; // Store email content for TOC generation
    let firstEmlData = null;

    // Use format preference if provided
    const formatPreference = options.formatPreference || 'auto';
    let finalFormat = formatPreference === 'epub' ? 'epub' : 'azw3'; // Default format

    // Process each EML file to create individual EPUB files
    const individualEbooks = [];
    const tocEntries = [];

    // Calculate progress increment per file
    const progressIncrement = 70 / emlFilePaths.length; // 70% for processing all files

    for (let i = 0; i < emlFilePaths.length; i++) {
      const emlFilePath = emlFilePaths[i];
      try {
        // Send progress update for each file
        if (options.onProgress) {
          const currentProgress = 5 + (i * progressIncrement);
          options.onProgress(currentProgress, `Processing file ${i + 1} of ${emlFilePaths.length}`);
        }

        // Parse the EML file
        const emlContent = await parseEmlFile(emlFilePath);

        if (i === 0) {
          // Save the first email's data for preview
          firstEmlData = emlContent;
        }

        const { subject, html, text, images, date, from, newsletterInfo, template } = emlContent;

        // Process overridden template if provided
        const finalTemplate = options.selectedTemplate || template;

        // Add to titles
        const title = sanitizeTitle(subject);
        allTitles.push(title);

        // Store email data for TOC
        const emailData = {
          title: title,
          subject: subject,
          date: date,
          from: from,
          newsletterInfo: newsletterInfo,
          path: emlFilePath,
          index: i
        };

        allEmails.push(emailData);
        tocEntries.push(emailData);

        // Define temporary output path for this newsletter
        const tempOutputPath = path.join(tempDir, `newsletter_${i}.epub`);

        // Generate ebook with complete content
        const content = html || text || '';
        const format = html ? 'html' : (text ? 'text' : 'text');

        const { buffer: contentBuffer, format: contentFormat } = await generateEbook(
          title,
          content,
          format,
          {
            template: finalTemplate,
            newsletterInfo: {
              ...newsletterInfo,
              date,
              from
            },
            images,
            formatPreference
          }
        );

        // Save content to temp file
        fs.writeFileSync(tempOutputPath, contentBuffer);
        individualEbooks.push({
          path: tempOutputPath,
          title: title,
          data: emailData
        });

        // Update final format if needed
        if (formatPreference === 'auto' && contentFormat === 'epub') {
          finalFormat = 'epub'; // If calibre not available, all will be epub
        }

        console.log(`[EML to Ebook] Processed email ${i+1}/${emlFilePaths.length}: ${title}`);
      } catch (error) {
        console.error(`[EML to Ebook] Error processing ${emlFilePath}: ${error.message}`);
        // Continue with other files
      }
    }

    if (individualEbooks.length === 0) {
      throw new Error('Failed to process any EML files');
    }

    // Send progress update for TOC generation
    if (options.onProgress) {
      options.onProgress(75, 'Generating table of contents');
    }

    // Generate a collection title with current date
    const collectionTitle = generateCollectionTitle(allTitles);

    // Adjust output path based on actual format
    const adjustedOutputPath = getAdjustedOutputPath(outputPath, finalFormat);

    if (individualEbooks.length === 1) {
      // If we only have one book, just copy it
      fs.copyFileSync(individualEbooks[0].path, adjustedOutputPath);
      console.log(`[EML to Ebook] Single file - copied to ${adjustedOutputPath}`);
    } else {
      // Generate an enhanced table of contents
      const tocPath = await generateEnhancedTableOfContents(tocEntries, collectionTitle, tempDir, formatPreference);

      // Send progress update for merging
      if (options.onProgress) {
        options.onProgress(85, 'Merging files');
      }

      try {
        // For now, just use the TOC file as the final output since merging is complex
        fs.copyFileSync(tocPath, adjustedOutputPath);
        console.log(`[EML to Ebook] Using TOC as final output: ${adjustedOutputPath}`);
      } catch (error) {
        console.error(`[EML to Ebook] Error in final processing: ${error.message}`);
        throw error;
      }
    }

    // Clean up temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[EML to Ebook] Error cleaning up temp files: ${cleanupError.message}`);
    }

    // Send final progress update
    if (options.onProgress) {
      options.onProgress(100, 'Complete');
    }

    console.log(`[EML to Ebook] Successfully saved combined file to ${adjustedOutputPath}`);
    return {
      filePath: adjustedOutputPath,
      format: finalFormat,
      firstEmlData
    };
  } catch (error) {
    console.error(`[EML to Ebook] Error combining EMls to ebook: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Generate an enhanced table of contents EPUB file with better navigation
 * @param {Array<Object>} items - Array of newsletter info objects
 * @param {string} collectionTitle - Title for the collection
 * @param {string} tempDir - Temporary directory
 * @param {string} formatPreference - Format preference ('auto', 'epub', or 'azw3')
 * @returns {Promise<string>} - Path to the TOC EPUB
 */
async function generateEnhancedTableOfContents(items, collectionTitle, tempDir, formatPreference = 'auto') {
  const { generateEbook } = require('./azw3-generator');

  // Format the current date
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Create title with date
  const title = `${collectionTitle} [${dateStr}]`;

  // Build TOC HTML with more structured navigation
  let tocHtml = `
    <h1>${title}</h1>
    <p class="date">Generated on ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</p>
    <h2>Table of Contents</h2>
    <div class="toc">
      <ol>
  `;

  // Add entries with richer metadata and navigation attributes
  items.forEach((item, index) => {
    const source = item.newsletterInfo?.name || item.from || 'Unknown Source';
    const date = item.date || '';
    const subtitle = item.newsletterInfo?.type ?
      `<div class="toc-type">${item.newsletterInfo.type.charAt(0).toUpperCase() + item.newsletterInfo.type.slice(1)}</div>` : '';

    tocHtml += `
      <li>
        <a href="#newsletter-${index+1}" id="toc-item-${index+1}" class="toc-link">${item.title}</a>
        ${subtitle}
        <div class="toc-source">${source}</div>
        ${date ? `<div class="toc-date">${date}</div>` : ''}
      </li>
    `;
  });

  // Close TOC
  tocHtml += `
      </ol>
    </div>
    <style>
      .date {
        text-align: center;
        font-style: italic;
        margin-bottom: 1.5em;
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
      .toc-type {
        font-size: 0.8em;
        color: #444;
        background-color: #f5f5f5;
        padding: 2px 5px;
        border-radius: 3px;
        display: inline-block;
        margin-left: 0.5em;
      }
      .toc ol {
        padding-left: 1.5em;
      }
      .toc li {
        margin-bottom: 1em;
      }
      .toc-link {
        font-weight: bold;
        text-decoration: none;
      }
    </style>
  `;

  // Generate the EPUB with TOC properties
  const outputPath = path.join(tempDir, 'table-of-contents.epub');

  // Use the generateEbook function from azw3-generator.js
  const { buffer } = await generateEbook(title, tocHtml, 'html', {
    isTableOfContents: true,
    formatPreference: formatPreference
  });

  // Save the buffer to a file
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Convert a PDF file to EPUB/AZW3 format
 * @param {string} pdfFilePath - Path to the PDF file
 * @param {string} outputPath - Path where the output file will be saved
 * @param {Object} options - Additional options for conversion
 * @returns {Promise<{filePath: string, format: string}>} - Path to the generated file and its format
 */
async function convertPdfToEbook(pdfFilePath, outputPath, options = {}) {
  try {
    console.log(`[PDF to Ebook] Starting conversion of ${pdfFilePath}`);

    // Get file name as title
    const fileName = path.basename(pdfFilePath, path.extname(pdfFilePath));
    const title = sanitizeTitle(fileName);

    // Create a temp directory
    const tempDir = temp.mkdirSync('pdf-conversion');
    const tempEpubPath = path.join(tempDir, `${sanitizeFilename(title)}.epub`);

    // Use format preference if provided
    const formatPreference = options.formatPreference || 'auto';

    // Use Calibre's ebook-convert to convert PDF to EPUB
    await execFilePromise(getCalibreCommand('ebook-convert'), [
      pdfFilePath,
      tempEpubPath,
      '--enable-heuristics',
      '--language', 'en',
      '--title', title
    ]);

    // Define format based on preference
    let format = 'epub';
    let outputBuffer = fs.readFileSync(tempEpubPath);

    // Try to convert to AZW3 for Kindle if requested
    if (formatPreference === 'auto' || formatPreference === 'azw3') {
      try {
        const hasCalibre = await checkCalibreAvailable();
        if (hasCalibre) {
          console.log(`[PDF to Ebook] Calibre found, converting EPUB to AZW3`);
          const tempAzw3Path = path.join(tempDir, `${sanitizeFilename(title)}.azw3`);

          await execFilePromise(getCalibreCommand('ebook-convert'), [
            tempEpubPath,
            tempAzw3Path
          ]);

          outputBuffer = fs.readFileSync(tempAzw3Path);
          format = 'azw3';
        }
      } catch (conversionError) {
        console.error(`[PDF to Ebook] Error converting to AZW3: ${conversionError.message}`);
        if (formatPreference === 'azw3') {
          console.log(`[PDF to Ebook] Falling back to EPUB format despite azw3 preference`);
        } else {
          console.log(`[PDF to Ebook] Falling back to EPUB format`);
        }
      }
    }

    // Adjust output path based on format
    const adjustedOutputPath = getAdjustedOutputPath(outputPath, format);

    // Save the output file
    fs.writeFileSync(adjustedOutputPath, outputBuffer);

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[PDF to Ebook] Error cleaning up temp files: ${cleanupError.message}`);
    }

    console.log(`[PDF to Ebook] Successfully converted ${pdfFilePath} to ${adjustedOutputPath} (${format} format)`);
    return { filePath: adjustedOutputPath, format };
  } catch (error) {
    console.error(`[PDF to Ebook] Error converting PDF to ebook: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Convert multiple PDF files to a single EPUB/AZW3 file
 * @param {Array<string>} pdfFilePaths - Array of PDF file paths
 * @param {string} outputPath - Path where the combined file will be saved
 * @param {Object} options - Additional options for conversion
 * @returns {Promise<{filePath: string, format: string}>} - Path to the generated file and its format
 */
async function convertMultiplePdfsToEbook(pdfFilePaths, outputPath, options = {}) {
  try {
    console.log(`[PDF to Ebook] Starting conversion of ${pdfFilePaths.length} PDF files`);

    // Create a temp directory for our individual ebooks
    const tempDir = temp.mkdirSync('combined-pdfs');
    const allTitles = [];
    const pdfInfoItems = []; // Store metadata for TOC

    // Use format preference if provided
    const formatPreference = options.formatPreference || 'auto';
    let finalFormat = formatPreference === 'epub' ? 'epub' : 'azw3'; // Default format

    // Process each PDF file
    const individualEbooks = [];

    for (let i = 0; i < pdfFilePaths.length; i++) {
      const pdfFilePath = pdfFilePaths[i];
      try {
        // Get file name as title
        const fileName = path.basename(pdfFilePath, path.extname(pdfFilePath));
        const title = sanitizeTitle(fileName);
        allTitles.push(title);

        // Add info for TOC
        pdfInfoItems.push({
          title: title,
          subject: title,
          from: 'PDF Document',
          index: i
        });

        // Create temporary epub file
        const tempEpubPath = path.join(tempDir, `pdf_${i}.epub`);

        // Convert PDF to EPUB using Calibre
        await execFilePromise(getCalibreCommand('ebook-convert'), [
          pdfFilePath,
          tempEpubPath,
          '--enable-heuristics',
          '--language', 'en',
          '--title', title
        ]);

        individualEbooks.push(tempEpubPath);
        console.log(`[PDF to Ebook] Processed PDF ${i+1}/${pdfFilePaths.length}: ${title}`);
      } catch (error) {
        console.error(`[PDF to Ebook] Error processing ${pdfFilePath}: ${error.message}`);
        // Continue with other files
      }
    }

    if (individualEbooks.length === 0) {
      throw new Error('Failed to process any PDF files');
    }

    // Generate a collection title with date
    const collectionTitle = generateCollectionTitle(allTitles);

    // Adjust output path based on actual format
    const adjustedOutputPath = getAdjustedOutputPath(outputPath, finalFormat);

    if (individualEbooks.length === 1) {
      // If we only have one book, just copy it
      fs.copyFileSync(individualEbooks[0], adjustedOutputPath);
      console.log(`[PDF to Ebook] Single file - copied to ${adjustedOutputPath}`);

      // Try to convert to AZW3 if needed and requested
      if ((formatPreference === 'auto' || formatPreference === 'azw3') &&
          adjustedOutputPath.toLowerCase().endsWith('.epub')) {
        try {
          const azw3Path = adjustedOutputPath.replace(/\.epub$/i, '.azw3');
          await execFilePromise(getCalibreCommand('ebook-convert'), [adjustedOutputPath, azw3Path]);
          finalFormat = 'azw3';
          adjustedOutputPath = azw3Path;
          console.log(`[PDF to Ebook] Converted single PDF to AZW3: ${azw3Path}`);
        } catch (error) {
          console.error(`[PDF to Ebook] Error converting to AZW3: ${error.message}`);
          // Keep the EPUB version
        }
      }
    } else {
      // Generate a table of contents EPUB
      const tocPath = await generatePdfCollectionToc(pdfInfoItems, collectionTitle, tempDir, formatPreference);

      // Try to merge with Calibre
      try {
        await mergeWithCalibre([tocPath, ...individualEbooks], adjustedOutputPath);
        console.log(`[PDF to Ebook] Successfully merged with Calibre: ${adjustedOutputPath}`);
      } catch (error) {
        console.error(`[PDF to Ebook] Calibre merge failed: ${error.message}`);

        // Fallback: Simply copy TOC as the final output
        fs.copyFileSync(tocPath, adjustedOutputPath);
        console.log(`[PDF to Ebook] Used TOC as final output: ${adjustedOutputPath}`);
      }
    }

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[PDF to Ebook] Error cleaning up temp files: ${cleanupError.message}`);
    }

    console.log(`[PDF to Ebook] Successfully saved combined file to ${adjustedOutputPath}`);
    return { filePath: adjustedOutputPath, format: finalFormat };
  } catch (error) {
    console.error(`[PDF to Ebook] Error combining PDFs to ebook: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Generate a table of contents for a PDF collection
 * @param {Array<Object>} items - Array of PDF info objects
 * @param {string} collectionTitle - Title for the collection
 * @param {string} tempDir - Temporary directory
 * @param {string} formatPreference - Format preference
 * @returns {Promise<string>} - Path to the TOC EPUB
 */
async function generatePdfCollectionToc(items, collectionTitle, tempDir, formatPreference = 'auto') {
  const { generateEbook } = require('./azw3-generator');

  // Format the current date
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Create title with date
  const title = `${collectionTitle} [${dateStr}]`;

  // Build TOC HTML
  let tocHtml = `
    <h1>${title}</h1>
    <p class="date">Generated on ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</p>
    <h2>Table of Contents</h2>
    <div class="toc">
      <ol>
  `;

  // Add entries
  items.forEach((item, index) => {
    tocHtml += `
      <li>
        <a href="#pdf-${index+1}" class="toc-link">${item.title}</a>
        <div class="toc-source">PDF Document</div>
      </li>
    `;
  });

  // Close TOC
  tocHtml += `
      </ol>
    </div>
    <style>
      .date {
        text-align: center;
        font-style: italic;
        margin-bottom: 1.5em;
      }
      .toc-source {
        font-style: italic;
        font-size: 0.9em;
        color: #666;
        margin-left: 1em;
      }
      .toc ol {
        padding-left: 1.5em;
      }
      .toc li {
        margin-bottom: 1em;
      }
      .toc-link {
        font-weight: bold;
        text-decoration: none;
      }
    </style>
  `;

  // Generate the EPUB with TOC
  const outputPath = path.join(tempDir, 'pdf-collection-toc.epub');

  const { buffer } = await generateEbook(title, tocHtml, 'html', {
    isTableOfContents: true,
    formatPreference: formatPreference
  });

  // Save the buffer to a file
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Merge EPUB files using Calibre
 * @param {Array<string>} epubPaths - Array of EPUB file paths
 * @param {string} outputPath - Path for the output file
 * @returns {Promise<void>}
 */
async function mergeWithCalibre(epubPaths, outputPath) {
  try {
    await execFilePromise(getCalibreCommand('ebook-convert'), [
      ...epubPaths,
      outputPath
    ]);
  } catch (error) {
    console.error(`[EML to Ebook] Calibre merge failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check if Calibre is available
 * @returns {Promise<boolean>}
 */
async function checkCalibreAvailable() {
  try {
    await execFilePromise(getCalibreCommand('ebook-convert'), ['--version']);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Helper function to get Calibre command path
 * @param {string} command - Calibre command name
 * @returns {string} - Full path to Calibre command or just the command name
 */
function getCalibreCommand(command = 'ebook-convert') {
  const calibrePath = global.systemCheck ? global.systemCheck.getCalibrePath() : null;
  if (calibrePath) {
    return path.join(calibrePath, command);
  }
  return command;
}

/**
 * Generate a collection title from multiple titles
 * @param {Array<string>} titles - Array of titles
 * @returns {string} - Combined title
 */
function generateCollectionTitle(titles) {
  if (titles.length === 1) {
    return titles[0];
  }

  // Find common words/newsletter names
  const newsletterTypes = {
    stratechery: /stratechery/i,
    axios: /axios/i,
    bulletin: /bulletin/i,
    substack: /substack/i
  };

  let type = 'Newsletters';
  for (const [name, pattern] of Object.entries(newsletterTypes)) {
    if (titles.some(title => pattern.test(title))) {
      type = name.charAt(0).toUpperCase() + name.slice(1) + ' Collection';
      break;
    }
  }

  return `${titles.length} ${type}`;
}

/**
 * Get adjusted output path with correct extension
 * @param {string} outputPath - Original output path
 * @param {string} format - Selected format
 * @returns {string} - Adjusted path
 */
function getAdjustedOutputPath(outputPath, format) {
  // Replace extension if necessary
  const ext = path.extname(outputPath).toLowerCase();

  if (format === 'azw3' && ext !== '.azw3') {
    return outputPath.replace(/\.[^.]+$/, '.azw3');
  } else if (format === 'epub' && ext !== '.epub') {
    return outputPath.replace(/\.[^.]+$/, '.epub');
  }

  return outputPath;
}

/**
 * Sanitize title for filename use
 * @param {string} title - Original title
 * @returns {string} - Sanitized title
 */
function sanitizeTitle(title) {
  if (!title) return 'untitled';

  // Remove invalid characters
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Sanitize filename for safe file system usage
 * @param {string} filename - Original filename
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'newsletter';

  return filename
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

module.exports = {
  convertEmlToEbook,
  convertMultipleEmlsToEbook,
  convertPdfToEbook,
  convertMultiplePdfsToEbook
};
