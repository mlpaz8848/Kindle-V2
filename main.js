const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const emlParser = require('./utils/eml-parser');
const emlToEbook = require('./utils/eml-to-azw3-converter');
const pdfProcessor = require('./utils/pdf-processor');
// Correct the require path - make sure path is accurate
const mailDropHandler = require('./utils/mail-drop-handler');
const systemCheck = require('./utils/system-check');
const os = require('os');

// Diagnostics for mailDropHandler
console.log('[Main] Mail Drop Handler Loaded:', typeof mailDropHandler, Object.keys(mailDropHandler));
// Verify that handleMailDrop is a function
if (mailDropHandler && typeof mailDropHandler.handleMailDrop === 'function') {
  console.log('[Main] mailDropHandler.handleMailDrop function found and loaded correctly');
} else {
  console.error('[Main] ERROR: mailDropHandler.handleMailDrop is not a function or mailDropHandler failed to load!');
}

// Set up error logging to file
const logPath = path.join(__dirname, 'app-error-log.txt');

function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, logMessage);
  } catch (err) {
    // Failsafe in case we can't write to the log file
    console.error(`Could not write to log file: ${err.message}`);
  }
}

// Override console.error for file logging
const originalConsoleError = console.error;
console.error = function() {
  // Convert arguments to string
  const args = Array.from(arguments).map(arg => {
    if (typeof arg === 'object') {
      try {
        // Limit depth/length of stringified objects to prevent huge logs
        return JSON.stringify(arg, (key, value) => {
             if (value && typeof value === 'string' && value.length > 500) {
                return value.substring(0, 500) + '...[truncated]';
             }
             return value;
        }, 2); // Add indentation for readability
      } catch (e) {
        return String(arg);
      }
    }
    // Truncate long strings directly passed to console.error
    if (typeof arg === 'string' && arg.length > 1000) {
        arg = arg.substring(0, 1000) + '...[truncated]';
    }
    return String(arg);
  });

  const message = args.join(' ');

  // Call original console.error
  originalConsoleError.apply(console, arguments);

  // Also log to file
  logToFile(`ERROR: ${message}`);
};

// Add log method
function log(message, level = 'INFO') {
  const formattedMessage = `[${level}] ${message}`;
  console.log(formattedMessage);
  logToFile(formattedMessage);
}

let mainWindow;

// Helper function to get Calibre command
function getCalibreCommand(command = 'ebook-convert') {
  const calibrePath = global.systemCheck ? global.systemCheck.getCalibrePath() : null;
  if (calibrePath) {
    return path.join(calibrePath, command);
  }
  return command;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      // Use this instead of nodeIntegration for better security
      preload: path.join(__dirname, 'preload.js'),
      // Disable nodeIntegration for security
      nodeIntegration: false,
      // Enable context isolation for security
      contextIsolation: true,
      // Disable remote module
      enableRemoteModule: false,
      // Allow file system access through our preload APIs
      webSecurity: true,
      // Disable spellcheck if not needed
      spellcheck: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FFFFFF',
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile('index.html');

  // Uncomment this line to automatically open developer tools when the app starts
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Add error handling for uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logToFile(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}`);

    if (mainWindow) {
      mainWindow.webContents.send('ebook-generated', {
        success: false,
        error: `Uncaught error: ${error.message}`
      });
    }
  });

  // Add handler for unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    logToFile(`UNHANDLED REJECTION: ${reason instanceof Error ? `${reason.message}\n${reason.stack}` : reason}`);
  });
}
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logToFile(`UNCAUGHT EXCEPTION: ${error.message}\n${error.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logToFile(`UNHANDLED REJECTION: ${reason instanceof Error ? `${reason.message}\n${reason.stack}` : reason}`);
});

app.whenReady().then(async () => {
  log('App ready, creating window and ensuring directories');

  // Run system checks
  const checkResults = await systemCheck.runAllChecks();
  global.systemCheck = systemCheck; // Make it available globally

  log(`System check results: Calibre=${checkResults.hasCalibre}`);
  if (systemCheck.getCalibrePath()) {
    log(`Calibre found at: ${systemCheck.getCalibrePath()}`);
  }

  // Ensure directories BEFORE creating the window might be safer
  ensureRequiredDirectories();
  createWindow();


  // Register file handlers for both .eml and .pdf files
  app.setAsDefaultProtocolClient('file'); // This might require additional setup based on OS/build config

  // Set up file association handling
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      log(`App received open-file event for: ${filePath}`);

      if (mainWindow) {
        handleFileOpen(filePath);
      } else {
        // Store the path to open once the window is ready
         app.on('ready', () => handleFileOpen(filePath)); // Use 'ready' event
      }
    });
  });

  // Handle already running instance trying to open a file (Windows specific primarily)
   const gotTheLock = app.requestSingleInstanceLock();

   if (!gotTheLock) {
     app.quit();
   } else {
     app.on('second-instance', (event, commandLine, workingDirectory) => {
       // Someone tried to run a second instance, we should focus our window.
       if (mainWindow) {
         if (mainWindow.isMinimized()) mainWindow.restore();
         mainWindow.focus();
       }
       // Handle file path from command line arguments if available
       const filePath = commandLine.pop(); // Often the last argument is the file path
       if (filePath && fs.existsSync(filePath)) {
         handleFileOpen(filePath);
       }
     });
   }

  // Log app startup message including version info
  log(`Application started: ${app.getName()} v${app.getVersion()}`);
  log(`Running on: ${process.platform} (${os.release()})`);
  log(`Node version: ${process.versions.node}`);
  log(`Electron version: ${process.versions.electron}`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
      ensureRequiredDirectories(); // Ensure dirs again just in case
      createWindow();
  }
});

// Handle opening files passed to the app
function handleFileOpen(filePath) {
  if (!mainWindow) {
      log(`[Main] Window not ready for file open: ${filePath}`, 'WARN');
      // Optionally queue the file path until the window is ready
      return;
  }
  if (typeof filePath !== 'string' || filePath.trim() === '') {
      log(`[Main] Invalid file path received in handleFileOpen: ${filePath}`, 'ERROR');
      return;
  }
  try {
    log(`Handling file open request: ${filePath}`);

    // Basic check if path is valid before existsSync
    if (!path.isAbsolute(filePath)) {
        log(`[Main] Received relative path, attempting to resolve: ${filePath}`, 'WARN');
        filePath = path.resolve(filePath); // Attempt to resolve, might not work correctly depending on context
    }

    console.log(`[Main] Processing file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      if (mainWindow) {
        mainWindow.webContents.send('ebook-generated', {
          success: false,
          error: `File not found: ${path.basename(filePath)}`
        });
      }
      return;
    }

    // Get file extension
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === '.eml' || fileExt === '.pdf') {
      log(`Processing ${fileExt.toUpperCase()} file via file-dropped event: ${filePath}`);
      // Use the existing drop mechanism
      mainWindow.webContents.send('file-dropped', [filePath]);
    } else {
      log(`Unsupported file type for opening: ${fileExt}`, 'WARN');
       if (mainWindow) {
           mainWindow.webContents.send('ebook-generated', { success: false, error: `Unsupported file type: ${path.basename(filePath)}` });
       }
    }
  } catch (error) {
    console.error(`Error handling file open for ${filePath}: ${error.message}\n${error.stack}`);
     if (mainWindow) {
         mainWindow.webContents.send('ebook-generated', { success: false, error: `Error opening file: ${error.message}` });
     }
  }
}

// Ensure required directories exist
function ensureRequiredDirectories() {
  const dirsToEnsure = [
    path.join(os.homedir(), 'Downloads', 'kindle-books'),
    path.join(__dirname, 'temp')
  ];

  dirsToEnsure.forEach(dirPath => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
    }
  });
}

const requiredDirs = [
  path.join(__dirname, 'temp'),
  path.join(os.homedir(), 'Downloads', 'kindle-books')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Handle open file request
ipcMain.on('open-file', (event, { filePath }) => {
  if (!filePath || typeof filePath !== 'string') {
     console.error('Invalid file path received for open-file:', filePath);
     return;
  }
  try {
    log(`Request to open file: ${filePath}`);
    if (fs.existsSync(filePath)) {
      shell.openPath(filePath).then(errMsg => { // Renamed err to errMsg for clarity
        if (errMsg) { // Check if errMsg is not empty
          console.error(`Failed to open file ${filePath}: ${errMsg}`);
          mainWindow.webContents.send('file-operation-result', { success: false, error: errMsg });
        } else {
          log(`File opened successfully: ${filePath}`);
          // Optionally send success back?
          // mainWindow.webContents.send('file-operation-result', { success: true });
        }
      }).catch(openError => { // Catch potential promise rejection
          console.error(`Error opening file ${filePath} via shell.openPath: ${openError.message}`);
          mainWindow.webContents.send('file-operation-result', { success: false, error: openError.message });
      });
    } else {
      console.error(`File does not exist: ${filePath}`);
      mainWindow.webContents.send('file-operation-result', {
        success: false,
        error: `File does not exist: ${path.basename(filePath)}`
      });
    }
  } catch (error) {
    console.error('Error in open-file handler:', error);
    mainWindow.webContents.send('file-operation-result', {
      success: false,
      error: error.message
    });
  }
});

// Handle show file in folder request
ipcMain.on('show-in-folder', (event, { filePath }) => {
   if (!filePath || typeof filePath !== 'string') {
     console.error('Invalid file path received for show-in-folder:', filePath);
     return;
  }
  try {
    log(`Request to show in folder: ${filePath}`);
    // No need to check fs.existsSync here, showItemInFolder handles non-existent paths gracefully on most OS.
    shell.showItemInFolder(filePath);
    log(`Requested show file in folder: ${filePath}`);
    // Note: showItemInFolder doesn't return status, so we assume success if no exception.
    // mainWindow.webContents.send('file-operation-result', { success: true });

  } catch (error) {
    console.error('Error showing file in folder:', error);
    mainWindow.webContents.send('file-operation-result', {
      success: false,
      error: error.message
    });
  }
});

// Handle open Send to Kindle request
ipcMain.on('open-send-to-kindle', (event) => {
  try {
    log('Request to open Send to Kindle application');
    let sendToKindlePath = null;

    if (process.platform === 'darwin') {
      // Try different possible Mac paths
      const macPaths = [
        '/Applications/Send to Kindle.app',
        '/Applications/Amazon/Send to Kindle.app',
        path.join(os.homedir(), 'Applications/Send to Kindle.app')
      ];

      for (const p of macPaths) {
        log(`Checking macOS path: ${p}`);
        if (fs.existsSync(p)) {
          sendToKindlePath = p;
          break;
        }
      }

      // If not found in standard locations, try to find with spotlight
      if (!sendToKindlePath) {
        try {
          const { execSync } = require('child_process');
          const result = execSync('mdfind kMDItemFSName="Send to Kindle.app"').toString().trim();
          if (result) {
            const paths = result.split('\n');
            if (paths.length > 0) {
              sendToKindlePath = paths[0];
              log(`Found Send to Kindle with spotlight: ${sendToKindlePath}`);
            }
          }
        } catch (spotlightErr) {
          log(`Spotlight search failed: ${spotlightErr.message}`, 'WARN');
        }
      }
    } else if (process.platform === 'win32') {
      const pathsToCheck = [
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Amazon', 'Send to Kindle', 'SendToKindle.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Amazon', 'Send to Kindle', 'SendToKindle.exe')
      ];
      for (const p of pathsToCheck) {
          log(`Checking Windows path: ${p}`);
          if (fs.existsSync(p)) {
              sendToKindlePath = p;
              break;
          }
      }
    } else {
      log('Send to Kindle not supported on this platform', 'WARN');
      return mainWindow.webContents.send('file-operation-result', {
        success: false,
        error: 'Send to Kindle is not supported on this platform.'
      });
    }

    if (sendToKindlePath && fs.existsSync(sendToKindlePath)) {
      log(`Opening Send to Kindle at path: ${sendToKindlePath}`);

      // On macOS, we need to use 'open' command for applications
      if (process.platform === 'darwin') {
        const { exec } = require('child_process');
        exec(`open "${sendToKindlePath}"`, (error, stdout, stderr) => {
          if (error) {
            console.error(`Failed to open Send to Kindle: ${error.message}`);
            mainWindow.webContents.send('file-operation-result', {
              success: false,
              error: `Failed to open Send to Kindle: ${error.message}`
            });
          } else {
            log('Send to Kindle application opened successfully');
            mainWindow.webContents.send('file-operation-result', {
              success: true
            });
          }
        });
      } else {
        // For Windows, use shell.openPath
        shell.openPath(sendToKindlePath).then(errMsg => {
          if (errMsg) {
            console.error(`Failed to open Send to Kindle: ${errMsg}`);
            mainWindow.webContents.send('file-operation-result', {
              success: false,
              error: `Failed to open Send to Kindle: ${errMsg}`
            });
          } else {
            log('Send to Kindle application opened successfully');
            mainWindow.webContents.send('file-operation-result', {
              success: true
            });
          }
        }).catch(openError => {
           console.error(`Error opening Send to Kindle via shell.openPath: ${openError.message}`);
           mainWindow.webContents.send('file-operation-result', { success: false, error: openError.message });
        });
      }
    } else {
      console.error(`Send to Kindle application not found. Checked path(s): ${sendToKindlePath || 'None determined'}`);
      mainWindow.webContents.send('file-operation-result', {
        success: false,
        error: 'Send to Kindle application not found. Please install it from Amazon.'
      });
    }
  } catch (error) {
    console.error('Error opening Send to Kindle:', error);
    mainWindow.webContents.send('file-operation-result', {
      success: false,
      error: error.message
    });
  }
});

// Handle newsletter analysis request
ipcMain.on('analyze-newsletter', async (event, { path: emlFilePath }) => {
  try {
    console.log(`[Main] Analyzing newsletter: ${emlFilePath}`);
    const { parseEmlFile } = require('./utils/eml-parser');
    const emlContent = await parseEmlFile(emlFilePath);
    console.log('[Main] Newsletter analysis result:', emlContent);

    event.reply('newsletter-info', emlContent.newsletterInfo);
  } catch (error) {
    console.error(`[Main] Error analyzing newsletter: ${error.message}`);
    event.reply('newsletter-info', { type: 'generic', name: 'Newsletter', confidence: 0 });
  }
});

// Enhanced progress tracker with ability to send updates to renderer
const progressTracker = {
  _tasks: {},

  // Start tracking a new task
  startTask(taskId, totalSteps = 100) {
    this._tasks[taskId] = {
      id: taskId,
      totalSteps,
      currentStep: 0,
      startTime: Date.now(),
      completed: false,
      errors: []
    };
    log(`[Progress] Starting task ${taskId} with ${totalSteps} steps`);

    // Send initial progress to renderer
    this.sendProgressToRenderer(taskId, 0, "Starting...");

    return taskId;
  },

  // Send progress updates to the renderer process
  sendProgressToRenderer(taskId, percentage, status) {
    if (!mainWindow) return;

    try {
      mainWindow.webContents.send('progress-update', {
        taskId,
        percentage,
        status
      });
      log(`[Progress] Sent update to renderer: ${percentage}% - ${status}`);
    } catch (err) {
      console.error(`[Progress] Error sending progress to renderer: ${err.message}`);
    }
  },

  // Update progress on a task
  updateProgress(taskId, stepIncrement = 1) {
    if (!this._tasks[taskId]) {
      log(`[Progress] Warning: Trying to update non-existent task ${taskId}`, 'WARN');
      return false;
    }

    this._tasks[taskId].currentStep += stepIncrement;
    const percentage = Math.min(
      Math.floor((this._tasks[taskId].currentStep / this._tasks[taskId].totalSteps) * 100),
      99 // Cap at 99% until explicitly completed
    );

    log(`[Progress] Task ${taskId}: ${percentage}% (${this._tasks[taskId].currentStep}/${this._tasks[taskId].totalSteps})`);

    // Send progress to renderer
    this.sendProgressToRenderer(taskId, percentage, `Processing file ${this._tasks[taskId].currentStep} of ${this._tasks[taskId].totalSteps}`);

    return percentage;
  },

  // Mark a task as complete
  completeTask(taskId) {
    if (!this._tasks[taskId]) {
      log(`[Progress] Warning: Trying to complete non-existent task ${taskId}`, 'WARN');
      return false;
    }

    this._tasks[taskId].completed = true;
    this._tasks[taskId].endTime = Date.now();
    const duration = (this._tasks[taskId].endTime - this._tasks[taskId].startTime) / 1000;

    log(`[Progress] Task ${taskId} completed in ${duration.toFixed(2)}s`);

    // Send 100% completion to renderer
    this.sendProgressToRenderer(taskId, 100, "Complete");

    return true;
  },

  // Add an error to a task
  addError(taskId, error) {
    if (!this._tasks[taskId]) {
      log(`[Progress] Warning: Trying to add error to non-existent task ${taskId}`, 'WARN');
      return false;
    }

    this._tasks[taskId].errors.push({
      message: error.message || String(error),
      stack: error.stack,
      time: Date.now()
    });

    log(`[Progress] Task ${taskId} error added: ${error.message || String(error)}`, 'ERROR');

    // Send error status to renderer
    this.sendProgressToRenderer(taskId, -1, `Error: ${error.message || String(error)}`);

    return true;
  },

  // Get task status
  getTaskStatus(taskId) {
    return this._tasks[taskId] || null;
  }
};

// UPDATED: Process files dropped into the application
ipcMain.on('process-dropped-files', async (event, data) => {
  console.log('[Main] Received process-dropped-files event:', typeof data, data ? Object.keys(data) : 'null');
  
  // Check if data exists and has expected structure
  if (!data) {
    console.error('[Main] No data received in process-dropped-files event');
    return event.reply('ebook-generated', {
      success: false,
      error: 'Internal error: No file data received'
    });
  }
  
  // Ensure we have paths to process
  if (!data.paths || !Array.isArray(data.paths) || data.paths.length === 0) {
    console.error('[Main] Invalid or empty paths in process-dropped-files event:', data.paths);
    return event.reply('ebook-generated', {
      success: false,
      error: 'No valid files were selected for processing'
    });
  }
  
  // Log received paths for debugging
  console.log('[Main] Received file paths:', data.paths);
  
  // Ensure paths are strings and exist on filesystem
  const validPaths = [];
  for (const filePath of data.paths) {
    if (typeof filePath !== 'string') {
      console.warn(`[Main] Skipping non-string path: ${typeof filePath}`);
      continue;
    }
    
    const cleanPath = filePath.trim();
    
    try {
      if (fs.existsSync(cleanPath)) {
        validPaths.push(cleanPath);
        console.log(`[Main] Valid file found: ${cleanPath}`);
      } else {
        console.warn(`[Main] File does not exist: ${cleanPath}`);
      }
    } catch (error) {
      console.error(`[Main] Error checking file existence: ${error.message}`);
    }
  }
  
  if (validPaths.length === 0) {
    console.error('[Main] No valid files found after checking paths');
    return event.reply('ebook-generated', {
      success: false,
      error: 'No valid files found. Please ensure the files exist and are accessible.'
    });
  }
  
  console.log(`[Main] Processing ${validPaths.length} valid files`);
  
  // Extract format and template preferences
  const formatPreference = data.formatPreference || 'auto';
  const selectedTemplate = data.selectedTemplate || null;
  
  // Categorize files by type
  const emlFiles = [];
  const pdfFiles = [];
  
  // Create task ID for progress tracking
  const taskId = `task_${Date.now()}`;
  if (progressTracker && typeof progressTracker.startTask === 'function') {
    progressTracker.startTask(taskId, validPaths.length + 3); // Add extra steps for completion
  }
  
  validPaths.forEach(filePath => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.eml') {
      emlFiles.push(filePath);
    } else if (ext === '.pdf') {
      pdfFiles.push(filePath);
    } else {
      console.warn(`[Main] Unsupported file type: ${ext} for ${filePath}`);
    }
  });
  
  try {
    // Handle different file type combinations
    if (emlFiles.length > 0 && pdfFiles.length === 0) {
      // Only EML files
      if (emlFiles.length === 1) {
        // Process single EML - check if function exists
        if (typeof processSingleEml === 'function') {
          await processSingleEml(event, emlFiles[0], { formatPreference, selectedTemplate }, taskId);
        } else {
          // Fallback if function doesn't exist
          console.error('[Main] processSingleEml function is not defined');
          event.reply('ebook-generated', {
            success: false,
            error: 'Internal error: Email processing function not available'
          });
        }
      } else {
        // Process multiple EMLs - check if function exists
        if (typeof processMultipleEmls === 'function') {
          await processMultipleEmls(event, emlFiles, { formatPreference, selectedTemplate }, taskId);
        } else {
          // Fallback if function doesn't exist
          console.error('[Main] processMultipleEmls function is not defined');
          event.reply('ebook-generated', {
            success: false,
            error: 'Internal error: Multiple email processing function not available'
          });
        }
      }
    } else if (pdfFiles.length > 0 && emlFiles.length === 0) {
      // Only PDF files
      if (pdfFiles.length === 1) {
        // Process single PDF - check if function exists
        if (typeof processSinglePdf === 'function') {
          await processSinglePdf(event, pdfFiles[0], { formatPreference }, taskId);
        } else {
          // Fallback if function doesn't exist
          console.error('[Main] processSinglePdf function is not defined');
          event.reply('ebook-generated', {
            success: false,
            error: 'Internal error: PDF processing function not available'
          });
        }
      } else {
        // Process multiple PDFs - check if function exists
        if (typeof processMultiplePdfs === 'function') {
          await processMultiplePdfs(event, pdfFiles, { formatPreference }, taskId);
        } else {
          // Fallback if function doesn't exist
          console.error('[Main] processMultiplePdfs function is not defined');
          event.reply('ebook-generated', {
            success: false,
            error: 'Internal error: Multiple PDF processing function not available'
          });
        }
      }
    } else if (emlFiles.length > 0 && pdfFiles.length > 0) {
      // Mixed file types
      if (typeof processMixedFiles === 'function') {
        await processMixedFiles(event, emlFiles, pdfFiles, { formatPreference, selectedTemplate }, taskId);
      } else {
        // Fallback if function doesn't exist
        console.error('[Main] processMixedFiles function is not defined');
        event.reply('ebook-generated', {
          success: false,
          error: 'Internal error: Mixed file processing function not available'
        });
      }
    } else {
      console.error('[Main] No valid .eml or .pdf files found');
      event.reply('ebook-generated', {
        success: false,
        error: 'No valid email (.eml) or PDF (.pdf) files found for processing'
      });
    }
    
    // Complete the task if we have a progress tracker
    if (progressTracker && typeof progressTracker.completeTask === 'function') {
      progressTracker.completeTask(taskId);
    }
  } catch (error) {
    console.error(`[Main] Error processing files: ${error.message}\n${error.stack}`);
    
    // Record error in progress tracker if available
    if (progressTracker && typeof progressTracker.addError === 'function') {
      progressTracker.addError(taskId, error);
    }
    
    event.reply('ebook-generated', {
      success: false,
      error: `Error processing files: ${error.message}`
    });
  }
});

// UPDATED: Add options parameter and progress tracking to processSingleEml function
async function processSingleEml(event, emlFilePath, options = {}, taskId = null) {
  console.log(`[Main] Processing single EML file: ${emlFilePath}`);
  
  // Update progress if we have a taskId
  if (taskId) {
    progressTracker.updateProgress(taskId, 1);
    progressTracker.sendProgressToRenderer(taskId, 20, `Validating email file...`);
  }
  
  if (!fs.existsSync(emlFilePath)) {
    console.error(`[Main] File not found: ${emlFilePath}`);
    return event.reply('ebook-generated', {
      success: false,
      error: `File not found: ${path.basename(emlFilePath)}`
    });
  }
  
  // Define output path for the ebook
  const userHome = os.homedir();
  const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
  ensureRequiredDirectories(); // Ensure download dir exists
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseOutputPath = path.join(downloadDir, `${path.basename(emlFilePath, '.eml')}_${timestamp}`);
  
  try {
    // Update progress
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 40, `Parsing email content...`);
    }
    
    // First, analyze the newsletter to detect its type
    let emlData;
    try {
      emlData = await parseEmailForPreview(emlFilePath);
      console.log(`[Main] Newsletter detected as: ${emlData?.newsletterInfo?.type || 'generic'}`);
    } catch (analyzeError) {
      console.error(`[Main] Error analyzing email: ${analyzeError.message}`);
      // Continue with generic template if analysis fails
      emlData = { newsletterInfo: { type: 'generic', name: 'Newsletter', confidence: 0 } };
    }
    
    // Update progress
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 60, `Converting to ebook format...`);
    }
    
    // Call the emlToEbook.convertEmlToEbook function with options
    const { filePath, format } = await emlToEbook.convertEmlToEbook(
      emlFilePath,
      baseOutputPath + '.epub',
      {
        formatPreference: options.formatPreference || 'auto',
        selectedTemplate: options.selectedTemplate || emlData?.newsletterInfo?.type || 'generic'
      }
    );
    
    // Final progress update
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 90, `Finalizing ebook...`);
    }
    
    console.log(`[Main] Email converted successfully to: ${filePath} (${format} format)`);
    
    event.reply('ebook-generated', {
      success: true,
      filePath: filePath,
      format: format,
      formatName: format.toUpperCase(),
      preview: emlData
    });
  } catch (error) {
    console.error(`[Main] Error converting email to ebook: ${error.message}\n${error.stack}`);
    event.reply('ebook-generated', {
      success: false,
      error: `Error converting to ebook: ${error.message}`
    });
  }
}

// Helper function to parse email for preview
async function parseEmailForPreview(emlFilePath) {
  try {
    const { parseEmlFile } = require('./utils/eml-parser');
    const emlContent = await parseEmlFile(emlFilePath);
    
    // Extract the relevant data for preview
    return {
      subject: emlContent.subject || path.basename(emlFilePath, '.eml'),
      html: emlContent.html,
      text: emlContent.text,
      date: emlContent.date,
      from: emlContent.from,
      newsletterInfo: emlContent.newsletterInfo || { type: 'generic', name: 'Newsletter', confidence: 0 }
    };
  } catch (error) {
    console.error(`[Main] Error parsing email for preview: ${error.message}`);
    // Return basic info on error
    return {
      subject: path.basename(emlFilePath, '.eml'),
      text: `Error parsing email: ${error.message}`,
      newsletterInfo: { type: 'generic', name: 'Newsletter', confidence: 0 }
    };
  }
}

// UPDATED: Add options parameter and progress tracking to processMultipleEmls function
async function processMultipleEmls(event, paths, options = {}, taskId = null) {
  log(`[Main] Processing ${paths.length} EML files`);

  let previewContent = null;
  let errorMessages = [];

  // Update progress if we have a taskId
  if (taskId) {
    progressTracker.updateProgress(taskId, 1);
    progressTracker.sendProgressToRenderer(taskId, 20, `Verifying ${paths.length} email files...`);
  }

  // Validate file paths
  const validPaths = paths.filter(filePath => {
    if (typeof filePath !== 'string') return false; // Basic type check
    try {
      const exists = fs.existsSync(filePath);
      if (!exists) {
        log(`[Main] File does not exist (multiple EML): ${filePath}`, 'WARN');
        errorMessages.push(`File does not exist: ${path.basename(filePath)}`);
      }
      return exists;
    } catch (err) {
      log(`[Main] Invalid file path (multiple EML): ${filePath} - ${err.message}`, 'ERROR');
      errorMessages.push(`Invalid file path: ${path.basename(filePath)}`);
      return false;
    }
  });

  if (validPaths.length === 0) {
    log(`[Main] No valid EML files found to combine.`);
    return event.reply('ebook-generated', { // Use return
      success: false,
      error: 'No valid email files found. Make sure files exist and are accessible.' + (errorMessages.length > 0 ? ` Issues: ${errorMessages.join(', ')}` : '')
    });
  }
  if (validPaths.length < paths.length) {
      log(`[Main] Processing ${validPaths.length} out of ${paths.length} provided EML files.`, 'WARN');
  }

  log(`[Main] Combining ${validPaths.length} valid EML files`);

  // Define output path for the combined ebook
  const userHome = os.homedir();
  const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
  ensureRequiredDirectories(); // Ensure download dir exists
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseOutputPath = path.join(downloadDir, `Combined_Newsletters_${timestamp}`); // Base name

  try {
    // Update progress
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 40, `Parsing and combining ${validPaths.length} emails...`);
    }

    // Use the multi-email converter with options
    const { filePath, format, firstEmlData } = await emlToEbook.convertMultipleEmlsToEbook(
      validPaths,
      baseOutputPath + '.epub',
      {
        formatPreference: options.formatPreference || 'auto',
        selectedTemplate: options.selectedTemplate,
        onProgress: (percentage, status) => {
          // Send progress updates to renderer if we have a taskId
          if (taskId) {
            // Scale percentage to fit within our task progress (40-90%)
            const scaledPercentage = 40 + (percentage * 0.5); // Map 0-100 to 40-90
            progressTracker.sendProgressToRenderer(taskId, scaledPercentage, status);
          }
        }
      }
    );

    // Final progress update
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 95, `Finalizing ebook...`);
    }

    log(`[Main] Combined ebook successfully saved to: ${filePath} (${format} format)`);

    // Get a format-friendly name for display
    const formatName = format.toUpperCase();

    // Get preview content if available
    if (firstEmlData) {
      previewContent = {
        subject: firstEmlData.subject || `Combined ${validPaths.length} Newsletters`, // Default subject
        html: firstEmlData.html,
        text: firstEmlData.text,
        date: firstEmlData.date,
        from: firstEmlData.from,
        newsletterType: firstEmlData.newsletterInfo?.type || 'generic'
      };
    } else {
        // Provide a fallback preview if firstEmlData is missing
        previewContent = {
            subject: `Combined ${validPaths.length} Newsletters`,
            text: `Successfully combined ${validPaths.length} email files.`,
            from: 'Multiple Sources',
            date: '',
            newsletterType: 'combined'
        };
    }

    // Add info about skipped files if any
     if (errorMessages.length > 0) {
         previewContent.text += `\n\nNote: ${errorMessages.length} file(s) could not be processed.`;
     }


    event.reply('ebook-generated', {
      success: true,
      filePath: filePath,
      format: format,
      formatName: formatName,
      preview: previewContent
    });
  } catch (error) {
    console.error(`[Main] Error creating combined ebook: ${error.message}\n${error.stack}`);
    event.reply('ebook-generated', {
      success: false,
      error: `Error creating combined ebook: ${error.message}`
    });
  }
}

// UPDATED: Add options parameter and progress tracking to processSinglePdf function
async function processSinglePdf(event, pdfFilePath, options = {}, taskId = null) {
   log(`[Main] Processing single PDF file: ${pdfFilePath}`);

   // Update progress if we have a taskId
   if (taskId) {
     progressTracker.updateProgress(taskId, 1);
     progressTracker.sendProgressToRenderer(taskId, 25, `Validating PDF file...`);
   }

    if (!fs.existsSync(pdfFilePath)) {
        console.error(`File not found: ${pdfFilePath}`);
        if (mainWindow) {
          mainWindow.webContents.send('ebook-generated', {
            success: false,
            error: `File not found: ${path.basename(pdfFilePath)}`
          });
        }
        return;
    }

   // Define output path for the ebook
   const userHome = os.homedir();
   const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
   ensureRequiredDirectories(); // Ensure download dir exists
   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
   const baseOutputPath = path.join(downloadDir, `Converted_${path.basename(pdfFilePath, '.pdf')}_${timestamp}`); // Base name

   try {
        // Update progress
        if (taskId) {
          progressTracker.updateProgress(taskId, 1);
          progressTracker.sendProgressToRenderer(taskId, 50, `Converting PDF to ebook format...`);
        }

        // Single PDF processing using convertPdfToEbook with options
        const { filePath, format } = await emlToEbook.convertPdfToEbook(
          pdfFilePath,
          baseOutputPath + '.epub',
          { formatPreference: options.formatPreference || 'auto' }
        );

        // Final progress update
        if (taskId) {
          progressTracker.updateProgress(taskId, 1);
          progressTracker.sendProgressToRenderer(taskId, 90, `Finalizing PDF conversion...`);
        }

        log(`[Main] PDF converted successfully to: ${filePath} (${format} format)`);

        // Extract basic PDF info for preview
        let pdfInfo = { title: path.basename(pdfFilePath, '.pdf'), author: 'Unknown', pageCount: 0, text: '' };
        try {
            pdfInfo = await pdfProcessor.extractFromPDF(pdfFilePath);
        } catch (extractError) {
            log(`[Main] Could not extract full PDF info for preview: ${extractError.message}`, 'WARN');
        }


        event.reply('ebook-generated', {
            success: true,
            filePath: filePath,
            format: format,
            formatName: format.toUpperCase(),
            preview: {
            subject: pdfInfo.title || path.basename(pdfFilePath, '.pdf'),
            text: (pdfInfo.text && pdfInfo.text.length > 10) ? pdfInfo.text.substring(0, 200) + (pdfInfo.text.length > 200 ? '...' : '') : `PDF Document with ${pdfInfo.pageCount} pages.`,
            from: pdfInfo.author || 'Unknown Author',
            date: '', // PDF doesn't have a standard 'sent date' like email
            newsletterType: 'pdf' // Specific type for preview handling
            }
        });
    } catch (error) {
        console.error(`[Main] Error converting single PDF ebook ${pdfFilePath}: ${error.message}\n${error.stack}`);
        event.reply('ebook-generated', {
        success: false,
        error: `Error converting PDF ebook: ${error.message}`
        });
    }
}

// UPDATED: Add options parameter and progress tracking to processMultiplePdfs function
async function processMultiplePdfs(event, paths, options = {}, taskId = null) {
  log(`[Main] Processing ${paths.length} PDF files`);

  // Update progress if we have a taskId
  if (taskId) {
    progressTracker.updateProgress(taskId, 1);
    progressTracker.sendProgressToRenderer(taskId, 20, `Validating ${paths.length} PDF files...`);
  }

   // Validate file paths
  const validPaths = paths.filter(filePath => {
    if (typeof filePath !== 'string') return false;
    try {
      const exists = fs.existsSync(filePath);
       if (!exists) {
          log(`[Main] File does not exist (multiple PDF): ${filePath}`, 'WARN');
       }
      return exists;
    } catch (err) {
      log(`[Main] Invalid file path (multiple PDF): ${filePath} - ${err.message}`, 'ERROR');
      return false;
    }
  });

   if (validPaths.length === 0) {
    log(`[Main] No valid PDF files found to combine.`);
    return event.reply('ebook-generated', { // Use return
      success: false,
      error: 'No valid PDF files found. Make sure files exist and are accessible.'
    });
  }
   if (validPaths.length < paths.length) {
      log(`[Main] Processing ${validPaths.length} out of ${paths.length} provided PDF files.`, 'WARN');
  }


  // Define output path for the ebook
  const userHome = os.homedir();
  const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
  ensureRequiredDirectories(); // Ensure download dir exists
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseOutputPath = path.join(downloadDir, `Combined_PDFs_${timestamp}`); // Base name

  try {
    // Update progress
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 40, `Converting and combining ${validPaths.length} PDFs...`);
    }

    // Multiple PDFs processing using convertMultiplePdfsToEbook with options
    const { filePath, format } = await emlToEbook.convertMultiplePdfsToEbook(
      validPaths,
      baseOutputPath + '.epub',
      { formatPreference: options.formatPreference || 'auto' }
    );

    // Final progress update
    if (taskId) {
      progressTracker.updateProgress(taskId, 1);
      progressTracker.sendProgressToRenderer(taskId, 90, `Finalizing combined PDF ebook...`);
    }

    log(`[Main] Multiple PDFs converted successfully to: ${filePath} (${format} format)`);

    event.reply('ebook-generated', {
      success: true,
      filePath: filePath,
      format: format,
      formatName: format.toUpperCase(),
      preview: {
        subject: `Collection of ${validPaths.length} PDF Documents`,
        text: `Combined ${validPaths.length} PDF documents for Kindle.` + (validPaths.length < paths.length ? ` (${paths.length - validPaths.length} skipped due to errors)` : ''),
        from: 'Multiple Sources',
        date: '',
        newsletterType: 'pdf'
      }
    });

  } catch (error) {
    console.error(`[Main] Error creating combined PDF ebook: ${error.message}\n${error.stack}`);
    event.reply('ebook-generated', {
      success: false,
      error: `Error creating combined PDF ebook: ${error.message}`
    });
  }
}

// UPDATED: Add options parameter and progress tracking to processMixedFiles function
async function processMixedFiles(event, emlPaths, pdfPaths, options = {}, taskId = null) {
  log(`[Main] Processing mixed files: ${emlPaths.length} EMLs and ${pdfPaths.length} PDFs`);

  // Update progress if we have a taskId
  if (taskId) {
    progressTracker.updateProgress(taskId, 1);
    progressTracker.sendProgressToRenderer(taskId, 20, `Checking mixed file types...`);
  }

  // Validate paths for both types
  const validEmlPaths = emlPaths.filter(filePath => typeof filePath === 'string' && fs.existsSync(filePath));
  const validPdfPaths = pdfPaths.filter(filePath => typeof filePath === 'string' && fs.existsSync(filePath));
  const skippedEml = emlPaths.length - validEmlPaths.length;
  const skippedPdf = pdfPaths.length - validPdfPaths.length;

  if (validEmlPaths.length === 0 && validPdfPaths.length === 0) {
      log('[Main] No valid EML or PDF files found in mixed input.');
      return event.reply('ebook-generated', {
          success: false,
          error: 'No valid email or PDF files found in the dropped items.'
      });
  }

  log(`[Main] Valid EMLs: ${validEmlPaths.length} (Skipped: ${skippedEml}). Valid PDFs: ${validPdfPaths.length} (Skipped: ${skippedPdf})`);

  // For mixed files, we'll create separate ebooks for each type
  const userHome = os.homedir();
  const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
  ensureRequiredDirectories(); // Ensure download dir exists
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  let emlResult = null;
  let pdfResult = null;
  let errors = [];

  // Process the EML files if any are valid
  if (validEmlPaths.length > 0) {
      // Update progress for email processing
      if (taskId) {
        progressTracker.updateProgress(taskId, 1);
        progressTracker.sendProgressToRenderer(taskId, 35, `Processing ${validEmlPaths.length} email files...`);
      }

      const emlOutputPath = path.join(downloadDir, `Email_Collection_${timestamp}`); // Base name
      try {
          if (validEmlPaths.length === 1) {
              emlResult = await emlToEbook.convertEmlToEbook(
                validEmlPaths[0],
                emlOutputPath + '.epub',
                {
                  formatPreference: options.formatPreference || 'auto',
                  selectedTemplate: options.selectedTemplate
                }
              );
          } else {
              emlResult = await emlToEbook.convertMultipleEmlsToEbook(
                validEmlPaths,
                emlOutputPath + '.epub',
                {
                  formatPreference: options.formatPreference || 'auto',
                  selectedTemplate: options.selectedTemplate
                }
              );
          }
          log(`[Main] Created Email Collection: ${emlResult.filePath}`);
      } catch (emlError) {
          console.error(`[Main] Error creating Email Collection: ${emlError.message}\n${emlError.stack}`);
          errors.push(`Failed to process ${validEmlPaths.length} emails: ${emlError.message}`);
      }
  }

  // Process the PDF files if any are valid
  if (validPdfPaths.length > 0) {
      // Update progress for PDF processing
      if (taskId) {
        progressTracker.updateProgress(taskId, 1);
        progressTracker.sendProgressToRenderer(taskId, 65, `Processing ${validPdfPaths.length} PDF files...`);
      }

      const pdfOutputPath = path.join(downloadDir, `PDF_Collection_${timestamp}`); // Base name
       try {
           if (validPdfPaths.length === 1) {
               pdfResult = await emlToEbook.convertPdfToEbook(
                 validPdfPaths[0],
                 pdfOutputPath + '.epub',
                 { formatPreference: options.formatPreference || 'auto' }
               );
           } else {
               pdfResult = await emlToEbook.convertMultiplePdfsToEbook(
                 validPdfPaths,
                 pdfOutputPath + '.epub',
                 { formatPreference: options.formatPreference || 'auto' }
               );
           }
           log(`[Main] Created PDF Collection: ${pdfResult.filePath}`);
      } catch (pdfError) {
          console.error(`[Main] Error creating PDF Collection: ${pdfError.message}\n${pdfError.stack}`);
          errors.push(`Failed to process ${validPdfPaths.length} PDFs: ${pdfError.message}`);
      }
  }

  // Final progress update
  if (taskId) {
    progressTracker.updateProgress(taskId, 1);
    progressTracker.sendProgressToRenderer(taskId, 90, `Finalizing mixed content...`);
  }

  if (!emlResult && !pdfResult) {
      // Both failed or no valid files
      return event.reply('ebook-generated', {
          success: false,
          error: `Failed to process files. Errors: ${errors.join('; ')}`
      });
  }

  // Prepare response
  const response = {
      success: true,
      filePath: emlResult ? emlResult.filePath : pdfResult.filePath, // Primary file for opening
      format: emlResult ? emlResult.format : pdfResult.format,
      formatName: (emlResult ? emlResult.format : pdfResult.format).toUpperCase(),
      additionalFiles: [],
      preview: {
          subject: `Mixed Content (${validEmlPaths.length} Emails, ${validPdfPaths.length} PDFs)`,
          html: `<p>Created separate ebooks:</p>`,
          from: 'Multiple Sources',
          date: '',
          newsletterType: 'mixed'
      }
  };

  if (emlResult) {
      response.preview.html += `<p> - Email Collection (${validEmlPaths.length} file${validEmlPaths.length > 1 ? 's' : ''}): ${path.basename(emlResult.filePath)}</p>`;
  }
  if (pdfResult) {
       response.preview.html += `<p> - PDF Collection (${validPdfPaths.length} file${validPdfPaths.length > 1 ? 's' : ''}): ${path.basename(pdfResult.filePath)}</p>`;
       // Set primary file path correctly if only PDF succeeded
       if (!emlResult) {
           response.filePath = pdfResult.filePath;
           response.format = pdfResult.format;
           response.formatName = pdfResult.format.toUpperCase();
       } else {
           // Add PDF path as additional if both succeeded
           response.additionalFiles.push(pdfResult.filePath);
       }
  }

  // Add error/skipped info to preview
  let notes = [];
  if (skippedEml > 0) notes.push(`${skippedEml} email file(s) skipped (invalid/inaccessible).`);
  if (skippedPdf > 0) notes.push(`${skippedPdf} PDF file(s) skipped (invalid/inaccessible).`);
  if (errors.length > 0) notes.push(`Processing errors encountered: ${errors.join('; ')}`);

  if (notes.length > 0) {
      response.preview.html += `<p style="color:orange;margin-top:10px;">Notes:<br/>${notes.join('<br/>')}</p>`;
  }

  event.reply('ebook-generated', response);
}

// Helper to sanitize titles for filenames
function sanitizeTitle(title) {
  if (!title) return 'newsletter';
  // Remove characters that are invalid in Windows/Mac filenames
  // Replace sequences of whitespace with a single underscore
  // Limit length to avoid overly long filenames
  return title.replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
              .replace(/\s+/g, '_')        // Replace whitespace with underscore
              .trim()
              .substring(0, 60);           // Limit length
}

function handleFileDrop(paths) {
  if (!Array.isArray(paths)) {
    console.error('[Renderer] Invalid file paths:', paths);
    showStatus('Error: Invalid file paths received. Please try again.', 'error', 5000);
    return;
  }

  ipcRenderer.send('process-dropped-files', { paths });
}
