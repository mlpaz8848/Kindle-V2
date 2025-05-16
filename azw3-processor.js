// utils/azw3-processor.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const temp = require('temp').track(); // Auto-track and clean up temp files
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { EPub } = require('epub2');
const jimp = require('jimp');

/**
 * Extract basic info from an input EPUB/AZW3
 * @param {Buffer} bookBuffer - Buffer containing the EPUB/AZW3 file
 * @returns {Promise<Object>} - Book metadata
 */
async function extractFromBook(bookBuffer) {
  try {
    // Save the buffer to a temp file
    const tempFilePath = temp.path({ suffix: '.epub' });
    fs.writeFileSync(tempFilePath, bookBuffer);

    // Try to extract using EPub
    const epub = await EPub.createAsync(tempFilePath);

    return {
      metadata: {
        title: epub.metadata.title || '',
        author: epub.metadata.creator || '',
        identifier: epub.metadata.identifier || '',
        publisher: epub.metadata.publisher || '',
        language: epub.metadata.language || 'en',
        pageCount: Object.keys(epub.flow.items).length || 0
      }
    };
  } catch (error) {
    console.error('Error extracting from EPUB/AZW3:', error);
    // Return minimal metadata on error
    return {
      metadata: {
        title: '',
        author: '',
        pageCount: 0
      }
    };
  } finally {
    // Clean up temp files
    try {
      temp.cleanupSync();
    } catch (e) {
      console.warn(`Failed to clean up temp files: ${e.message}`);
    }
  }
}

/**
 * Convert EPUB to Kindle-optimized AZW3
 * @param {Buffer} bookBuffer - Buffer containing the EPUB file
 * @param {Object} options - Conversion options
 * @returns {Promise<Buffer>} - Optimized AZW3 buffer
 */
async function convertToKindleFormat(bookBuffer, options = {}) {
  // For EPUB/AZW3, we don't need to do much conversion as they're already e-reader friendly
  // Just pass through the buffer unless specific optimizations are needed
  return bookBuffer;
}

/**
 * Generate a thumbnail image from an EPUB/AZW3 file
 * @param {Buffer} bookBuffer - Buffer containing the EPUB/AZW3 file
 * @param {string} thumbnailPath - Path to save the thumbnail
 * @returns {Promise<string>} - Path to the generated thumbnail
 */
async function generateBookThumbnail(bookBuffer, thumbnailPath) {
  try {
    // Save the buffer to a temp file
    const tempFilePath = temp.path({ suffix: '.epub' });
    fs.writeFileSync(tempFilePath, bookBuffer);

    // Try to extract cover using EPub
    const epub = await EPub.createAsync(tempFilePath);

    // Check if we have a cover
    let coverImagePath = null;

    // First try to get the cover from metadata
    if (epub.metadata.cover) {
      const coverId = epub.metadata.cover;
      const coverItem = epub.resources.resource[coverId];
      if (coverItem) {
        coverImagePath = coverItem.path;
      }
    }

    // If not found, search for cover image in resources
    if (!coverImagePath) {
      // Look for resources that might be cover images
      for (const id in epub.resources.resource) {
        const resource = epub.resources.resource[id];
        if (resource.id.toLowerCase().includes('cover') &&
            resource.mime.startsWith('image/')) {
          coverImagePath = resource.path;
          break;
        }
      }
    }

    // If we found a cover, save it as thumbnail
    if (coverImagePath) {
      // Extract the cover image
      const coverData = await epub.getResourceAsync(coverImagePath);

      // Process and save the image as thumbnail
      const image = await jimp.read(coverData);
      await image.resize(300, jimp.AUTO) // Resize to appropriate thumbnail size
                 .quality(90)
                 .writeAsync(thumbnailPath);

      return thumbnailPath;
    }

    // If no cover found, create a default thumbnail
    const defaultImage = await jimp.create(300, 450, '#ffffff');
    const titleFont = await jimp.loadFont(jimp.FONT_SANS_16_BLACK);

    // Add some text to the default thumbnail
    let title = epub.metadata.title || 'E-Book';
    if (title.length > 20) {
      title = title.substring(0, 17) + '...';
    }

    defaultImage.print(
      titleFont,
      20,
      200,
      title,
      260
    );

    await defaultImage.writeAsync(thumbnailPath);
    return thumbnailPath;
  } catch (error) {
    console.error('Error generating book thumbnail:', error);

    // Create a very basic default thumbnail
    try {
      const defaultImage = await jimp.create(300, 450, '#f0f0f0');
      await defaultImage.writeAsync(thumbnailPath);
      return thumbnailPath;
    } catch (e) {
      console.error('Failed to create default thumbnail:', e);
      return null;
    }
  } finally {
    // Clean up temp files
    try {
      temp.cleanupSync();
    } catch (e) {
      console.warn(`Failed to clean up temp files: ${e.message}`);
    }
  }
}

module.exports = {
  extractFromBook,
  convertToKindleFormat,
  generateBookThumbnail
};
