// utils/pdf-processor.js - Simplified version
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

// Extract basic info from an input PDF
async function extractFromPDF(pdfBuffer) {
  try {
    // Get PDF metadata using pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    return {
      metadata: {
        pageCount: pdfDoc.getPageCount(),
        title: '',  // Basic version doesn't extract title
        author: '',
        creator: '',
        producer: ''
      }
    };
  } catch (error) {
    console.error('Error extracting from PDF:', error);
    throw error;
  }
}

// Convert PDF to Kindle-optimized PDF
async function convertPDFToKindleFormat(pdfBuffer, options) {
  try {
    // In this simplified version, we're just going to apply some basic
    // optimizations to the PDF rather than extracting text and images

    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Create a new PDF
    const kindlePdf = await PDFDocument.create();

    // Copy all pages from the original
    const pages = await kindlePdf.copyPages(pdfDoc, pdfDoc.getPageIndices());

    // Add each page to the new PDF
    for (const page of pages) {
      // Adjust page dimensions if needed
      if (options.adjustMargins) {
        // This is a simplification - in reality, you'd want more sophisticated margin adjustment
        const { width, height } = page.getSize();
        page.setCropBox(10, 10, width - 20, height - 20);
      }

      kindlePdf.addPage(page);
    }

    // Save the PDF
    const kindleBuffer = await kindlePdf.save();

    return Buffer.from(kindleBuffer);
  } catch (error) {
    console.error('Error converting PDF to Kindle format:', error);
    throw error;
  }
}

// Generate a thumbnail from the first page of a PDF
async function generatePDFThumbnail(pdfBuffer, thumbnailPath) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Create a new document with just the first page
    const thumbnailDoc = await PDFDocument.create();

    if (pdfDoc.getPageCount() > 0) {
      const [firstPage] = await thumbnailDoc.copyPages(pdfDoc, [0]);
      thumbnailDoc.addPage(firstPage);
    }

    // Save the document
    const thumbnailBuffer = await thumbnailDoc.save();
    fs.writeFileSync(thumbnailPath, thumbnailBuffer);

    return thumbnailPath;
  } catch (error) {
    console.error('Error generating PDF thumbnail:', error);
    // Return null but don't fail
    return null;
  }
}

module.exports = {
  extractFromPDF,
  convertPDFToKindleFormat,
  generatePDFThumbnail
};
