// utils/mail-drop-handler.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { ipcMain } = require('electron');
const execPromise = promisify(exec);

class MailDropHandler {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'kindle-mail-drop');

    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      try {
        fs.mkdirSync(this.tempDir, { recursive: true });
      } catch (err) {
        console.warn(`[Mail Drop] Could not create temp directory: ${err.message}`);
      }
    }
  }

  handleMailDrop(filePaths) {
    console.log('[Mail Drop Handler] Received filePaths:', filePaths, 'Type:', typeof filePaths);

    // Sanitize filePaths to ensure it's an array
    let sanitizedPaths = [];
    if (Array.isArray(filePaths)) {
      sanitizedPaths = filePaths;
    } else if (filePaths && typeof filePaths === 'string' && filePaths.trim() !== '') {
      sanitizedPaths = [filePaths.trim()];
    } else if (filePaths && typeof filePaths === 'object' && filePaths.paths && Array.isArray(filePaths.paths)) {
      sanitizedPaths = filePaths.paths;
    } else if (filePaths && typeof filePaths === 'object') {
      try {
        sanitizedPaths = Object.values(filePaths).filter(p => typeof p === 'string' && p.trim() !== '');
      } catch (e) {
        console.error('[Mail Drop Handler] Error converting object to array of paths:', e, 'Original object:', filePaths);
        sanitizedPaths = [];
      }
    } else {
      console.warn('[Mail Drop Handler] filePaths was not an array or convertible type, defaulting to empty. Original:', filePaths);
      sanitizedPaths = [];
    }

    // Use sanitizedPaths for filtering
    const validFiles = sanitizedPaths.filter(filePath => {
      if (!fs.existsSync(filePath)) {
        console.warn('[Mail Drop Handler] File not found:', filePath);
        return false;
      }
      return true;
    });

    console.log('[Mail Drop Handler] Valid files:', validFiles);
    return validFiles;
  }

  async extractMailContent() {
    // This is a placeholder for the actual Mail extraction logic
    // In a full implementation, this would use AppleScript or similar
    // to extract files from Mail.app
    return null;
  }

  async createTestFiles(filePaths) {
    // Ensure filePaths is always an array
    if (!Array.isArray(filePaths)) {
      if (typeof filePaths === 'string') {
        filePaths = [filePaths];
      } else {
        return [];
      }
    }
    
    // This is a helper method to create test files when needed
    // Only used during development for testing
    try {
      const testPaths = [];

      for (const filePath of filePaths) {
        // Get just the filename
        const fileName = path.basename(String(filePath));
        const testFilePath = path.join(this.tempDir, fileName);

        // Create a simple .eml file for testing
        const testContent = `From: test@example.com
To: recipient@example.com
Subject: ${fileName.replace('.eml', '')}
Date: ${new Date().toUTCString()}

This is a test email content for ${fileName}.
It was automatically created by the Kindle Newsletter Formatter for testing purposes.

Regards,
Test System`;

        // Write the file
        fs.writeFileSync(testFilePath, testContent);
        console.log(`[Mail Drop] Created test file at: ${testFilePath}`);
        testPaths.push(testFilePath);
      }

      return testPaths;
    } catch (error) {
      console.error(`[Mail Drop] Error creating test files: ${error.message}`);
      return [];
    }
  }
}

// Add a safe wrapper for ipcMain events
ipcMain.on('process-dropped-files', (event, data) => {
  if (!data || !data.paths) {
    console.error('[Mail Drop Handler] Missing paths in data:', data);
    event.sender.send('error', 'No valid files found for processing.');
    return;
  }
  
  const filePaths = data.paths;
  
  // Ensure filePaths is an array
  const pathsArray = Array.isArray(filePaths) ? filePaths : 
                    (typeof filePaths === 'string' ? [filePaths] : []);
  
  if (pathsArray.length === 0) {
    event.sender.send('error', 'No valid files found for processing.');
    return;
  }
  
  const validFiles = pathsArray.filter(filePath => 
    filePath && typeof filePath === 'string' && fs.existsSync(filePath)
  );
  
  if (validFiles.length === 0) {
    event.sender.send('error', 'No valid files found for processing.');
    return;
  }
  
  // Proceed with processing valid files...
  console.log('[Mail Drop Handler] Processing valid files:', validFiles);
  
  // Instead of processing here, just send back to continue normal flow
  event.sender.send('file-dropped', validFiles);
});

module.exports = new MailDropHandler();