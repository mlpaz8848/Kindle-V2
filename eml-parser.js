// utils/eml-parser.js - Minimal implementation to fix the immediate error

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

/**
 * Parse an .eml file to extract content
 * @param {string} emlFilePath - Path to the .eml file
 * @returns {Promise<Object>} - Extracted content including subject, text, html, and images
 */
async function parseEmlFile(emlFilePath) {
  console.log('[EML Parser] Received file path:', emlFilePath);

  if (!fs.existsSync(emlFilePath)) {
    console.error(`[EML Parser] File does not exist: ${emlFilePath}`);
    throw new Error(`File not found: ${emlFilePath}`);
  }

  try {
    // Read file content
    const emlContent = fs.readFileSync(emlFilePath, { encoding: 'utf8' });
    console.log(`[EML Parser] Read ${emlContent.length} bytes from file`);
    
    // Parse with mailparser
    const parsed = await simpleParser(emlContent);
    console.log('[EML Parser] Successfully parsed email content');
    
    // Basic data extraction
    const result = {
      subject: parsed.subject || path.basename(emlFilePath, '.eml'),
      from: parsed.from ? (parsed.from.text || '') : '',
      text: parsed.text || '',
      html: parsed.html || '',
      date: parsed.date ? parsed.date.toUTCString() : new Date().toUTCString(),
      attachments: parsed.attachments || [],
      newsletterInfo: { type: 'generic', name: 'Newsletter', confidence: 0 }
    };
    
    // Try to detect newsletter type if the newsletter-detector module is available
    try {
      const newsletterDetector = require('./newsletter-detector');
      if (newsletterDetector && typeof newsletterDetector.detectNewsletterType === 'function') {
        result.newsletterInfo = newsletterDetector.detectNewsletterType(result);
        console.log(`[EML Parser] Detected newsletter type: ${result.newsletterInfo.type}`);
      }
    } catch (detectorError) {
      console.warn(`[EML Parser] Cannot detect newsletter type: ${detectorError.message}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[EML Parser] Error parsing EML file: ${error.message}`);
    
    // Create a minimal result for errors
    return {
      subject: path.basename(emlFilePath, '.eml'),
      from: '',
      text: `Error parsing file: ${error.message}`,
      html: `<p>Error parsing file: ${error.message}</p>`,
      date: new Date().toUTCString(),
      newsletterInfo: { type: 'generic', name: 'Newsletter', confidence: 0 }
    };
  }
}

/**
 * Helper function to create a test EML file for debugging
 * @param {string} originalFilePath - The original file path that failed to parse
 * @returns {Promise<string>} - Path to the created test file
 */
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

// Only export the minimum required functions to fix the immediate error
module.exports = {
  parseEmlFile,
  createTestEmlFile
};