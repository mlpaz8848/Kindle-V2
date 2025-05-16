const fs = require('fs');
const path = require('path');
const os = require('os');

// Get user's home directory for better cross-platform support
const userHome = os.homedir();

// Create the kindle-pdfs directory in the downloads folder
const downloadDir = path.join(userHome, 'Downloads', 'kindle-pdfs');

if (!fs.existsSync(downloadDir)) {
  try {
    fs.mkdirSync(downloadDir, { recursive: true });
    console.log(`Successfully created directory: ${downloadDir}`);
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
  }
} else {
  console.log(`Directory already exists: ${downloadDir}`);
}

// Create assets directory if it doesn't exist
const assetsDir = path.join(__dirname, 'assets');

if (!fs.existsSync(assetsDir)) {
  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log(`Successfully created directory: ${assetsDir}`);
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
  }
} else {
  console.log(`Directory already exists: ${assetsDir}`);
}

// Create utils directory if it doesn't exist
const utilsDir = path.join(__dirname, 'utils');

if (!fs.existsSync(utilsDir)) {
  try {
    fs.mkdirSync(utilsDir, { recursive: true });
    console.log(`Successfully created directory: ${utilsDir}`);
  } catch (error) {
    console.error(`Error creating directory: ${error.message}`);
  }
} else {
  console.log(`Directory already exists: ${utilsDir}`);
}

console.log('All necessary directories have been checked and created if needed.');
