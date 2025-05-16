// utils/system-check.js
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFilePromise = promisify(execFile);
const fs = require('fs');
const path = require('path');

class SystemCheck {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.calibrePath = null;
  }

  async findCalibrePath() {
    try {
      if (process.platform === 'darwin') {
        // macOS: Try common installation locations
        const possiblePaths = [
          '/Applications/calibre.app/Contents/MacOS',
          '/usr/local/bin',
          path.join(process.env.HOME, '/Applications/calibre.app/Contents/MacOS')
        ];

        for (const testPath of possiblePaths) {
          const ebookConvertPath = path.join(testPath, 'ebook-convert');
          if (fs.existsSync(ebookConvertPath)) {
            this.calibrePath = testPath;
            return testPath;
          }
        }

        // Try using which command
        try {
          const { execSync } = require('child_process');
          const result = execSync('which ebook-convert').toString().trim();
          if (result) {
            this.calibrePath = path.dirname(result);
            return this.calibrePath;
          }
        } catch (err) {
          // which command failed, continue searching
        }
      } else if (process.platform === 'win32') {
        // Windows: Check common installation locations
        const possiblePaths = [
          'C:\\Program Files\\Calibre2',
          'C:\\Program Files (x86)\\Calibre2',
          path.join(process.env.LOCALAPPDATA, 'Calibre')
        ];

        for (const testPath of possiblePaths) {
          const ebookConvertPath = path.join(testPath, 'ebook-convert.exe');
          if (fs.existsSync(ebookConvertPath)) {
            this.calibrePath = testPath;
            return testPath;
          }
        }
      }
    } catch (error) {
      console.error('Error finding Calibre path:', error);
    }
    return null;
  }

  async checkCalibre() {
    try {
      // First try with existing PATH
      await execFilePromise('ebook-convert', ['--version']);
      return true;
    } catch (error) {
      // Try to find Calibre manually
      const calibrePath = await this.findCalibrePath();
      if (calibrePath) {
        // Test if we can execute from this path
        try {
          const ebookConvertPath = path.join(calibrePath, 'ebook-convert');
          await execFilePromise(ebookConvertPath, ['--version']);
          return true;
        } catch (err) {
          console.error('Found Calibre but cannot execute:', err);
        }
      }

      this.issues.push({
        type: 'calibre',
        message: 'Calibre not found in PATH. AZW3 conversion will not be available.',
        resolution: 'Install Calibre from https://calibre-ebook.com/download'
      });
      return false;
    }
  }

  async runAllChecks() {
    this.issues = [];
    this.warnings = [];

    // Check for Calibre
    const hasCalibre = await this.checkCalibre();

    return {
      hasCalibre,
      issues: this.issues,
      warnings: this.warnings
    };
  }

  getCalibrePath() {
    return this.calibrePath;
  }
}

module.exports = new SystemCheck();
