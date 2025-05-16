// renderer.js - Complete refreshed file
// Handles the renderer process for the Kindle Newsletter Formatter

// IPC Communication with main process through the secure bridge
const { ipc, dialog, fs } = window.electron;
const path = window.path;

// UI Elements
const dropZone = document.getElementById('eml-drop-zone');
const statusMessage = document.getElementById('status-message');
const previewPanel = document.getElementById('preview-content');
const generateKindleBtn = document.getElementById('generate-kindle-pdf-btn');
const outputPathDisplay = document.getElementById('output-path-display');
const clearBtn = document.getElementById('clear-btn');
const openFileBtn = document.getElementById('open-pdf-btn');
const showInFolderBtn = document.getElementById('show-in-folder-btn');
const openSendToKindleBtn = document.getElementById('open-send-to-kindle-btn');

// Format Selection
const formatOptions = document.querySelectorAll('input[name="format"]');

// Template Dialog Elements
const templateDialog = document.getElementById('template-dialog');
const detectedName = document.getElementById('detected-name');
const detectedType = document.getElementById('detected-type')?.querySelector('span');
const detectedConfidence = document.getElementById('detected-confidence')?.querySelector('span');
const templateSelector = document.getElementById('template-selector');
const templatePreview = document.getElementById('template-preview-content');
const templateConfirmBtn = document.getElementById('template-confirm-btn');
const templateCancelBtn = document.getElementById('template-cancel-btn');

// State
let uploadedFiles = [];
let generatedFilePath = null;
let additionalGeneratedFiles = [];
let generatedFileFormat = 'epub'; // Default format
let isProcessing = false;
let detectedNewsletterInfo = null; // Store detected newsletter info
let selectedTemplate = null; // Store selected template
let selectedFormat = 'auto'; // Store selected format
let progressInterval = null; // Store progress animation interval

// Init
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupDragAndDrop();
  addFilePicker();

  console.log('[Renderer] Initialized');

  // Set initial output path display
  const userHome = '/Users'; // Simplified since os.homedir() isn't available
  const downloadDir = `${userHome}/Downloads/kindle-books`;
  outputPathDisplay.textContent = downloadDir;

  // Set initial selected format
  selectedFormat = document.querySelector('input[name="format"]:checked')?.value || 'auto';
  console.log(`[Renderer] Initial format selected: ${selectedFormat}`);

  // Update button text to reflect ebook format
  if (openFileBtn) {
    openFileBtn.textContent = 'Open Ebook';
  }

  // Update generate button text if it exists
  if (generateKindleBtn) {
    generateKindleBtn.textContent = 'Generate Kindle Ebook';
  }

  // Set up IPC event listeners
  ipc.on('ebook-generated', (result) => {
    console.log('[Renderer] Received ebook-generated event:', result);
    isProcessing = false;
    dropZone.classList.remove('processing');

    // Clear progress animation interval if it exists
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }

    // Always update progress to 100% when done
    updateProgressDisplay(100, result.success ? 'Complete' : 'Failed');

    if (result.success) {
      generatedFilePath = result.filePath;
      generatedFileFormat = result.format || 'epub';
      const formatName = result.formatName || generatedFileFormat.toUpperCase();

      // Store any additional files (for mixed content)
      additionalGeneratedFiles = result.additionalFiles || [];

      showStatus(`${formatName} created successfully: ${path.basename(result.filePath)}`, 'success');
      openFileBtn.disabled = false;
      showInFolderBtn.disabled = false;
      if (openSendToKindleBtn) openSendToKindleBtn.disabled = false;

      // Update button text to reflect actual format
      if (openFileBtn) {
        openFileBtn.textContent = `Open ${formatName}`;
      }

      // Show success message
      updatePreviewWithSuccess(result);

      // If we have an email preview, show its content
      if (result.preview) {
        setTimeout(() => {
          updatePreviewWithContent(result.preview);
        }, 100);
      }

      dropZone.classList.add('processed');
    } else {
      // Even on error, we want to provide feedback and allow retrying
      const errorMessage = result.error || "Unknown error occurred";

      showStatus(`Ebook generation had issues: ${errorMessage}`, 'error', 8000);

      // Show a helpful error message with retry option
      previewPanel.innerHTML = `
        <div class="kindle-preview">
          <h2>Conversion Completed with Issues</h2>
          <div class="error-message" style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 15px 0;">
            <p><strong>Note:</strong> ${errorMessage}</p>
          </div>
          <div class="preview-summary">
            ${result.filePath ?
              `<p>An EPUB file was still created and saved to: <br><strong>${result.filePath}</strong></p>
               <p>You can still try to use this file with your Kindle, but it may have formatting issues.</p>` :
              `<p>The conversion process encountered errors. You may want to try again with different settings.</p>`
            }
          </div>
          <button id="retry-conversion" class="primary-btn" style="margin-top: 15px;">Retry Conversion</button>
          <div class="troubleshooting-tips" style="margin-top: 20px; padding: 15px; background-color: #e3f2fd; border-radius: 4px;">
            <h3>Troubleshooting Tips:</h3>
            <ul>
              <li>Try creating a simple test .eml file with plain text content</li>
              <li>Ensure your file has the correct .eml extension</li>
              <li>Try placing the file in your Downloads folder</li>
              <li>Try using a simpler filename without special characters</li>
            </ul>
            <p style="margin-top: 10px;"><strong>Creating a Test File:</strong> Create a text file with content like "From: test@example.com\\nTo: you@example.com\\nSubject: Test\\n\\nTest content" and save it with a .eml extension</p>
          </div>
        </div>
      `;

      // If we still created a file, enable the buttons
      if (result.filePath) {
        generatedFilePath = result.filePath;
        generatedFileFormat = 'epub'; // Default to EPUB on error
        openFileBtn.disabled = false;
        showInFolderBtn.disabled = false;
        if (openSendToKindleBtn) openSendToKindleBtn.disabled = false;
      }

      // Add retry button handler
      const retryButton = document.getElementById('retry-conversion');
      if (retryButton) {
        retryButton.addEventListener('click', () => {
          processSelectedFiles();
        });
      }
    }

    // Always re-enable the generate button if we have files
    updateGenerateButtonState(uploadedFiles.length > 0);
  });

  ipc.on('file-dropped', (filePaths) => {
    console.log('[Renderer] Received file-dropped event:', filePaths);
    if (Array.isArray(filePaths) && filePaths.length > 0) {
      handleSelectedFiles(filePaths);
    } else {
      console.error('[Renderer] Invalid file paths received:', filePaths);
      showStatus('Error: Invalid file paths received. Please try again.', 'error', 5000);
    }
  });

  ipc.on('newsletter-info', (info) => {
    console.log('[Renderer] Received newsletter-info event:', info);
    if (info && info.type) {
      // Store newsletter info
      detectedNewsletterInfo = info;

      // Show template confirmation dialog
      showTemplateConfirmation(info);
    } else {
      // If no newsletter info or generic type, proceed with default
      processSelectedFiles();
    }
  });

  ipc.on('progress-update', (data) => {
    console.log('[Renderer] Received progress update:', data);
    updateProgressDisplay(data.percentage, data.status);
  });

  ipc.on('error', (message) => {
    showStatus(`Error: ${message}`, 'error', 5000);
  });
});

// Event Listeners
function setupEventListeners() {
  if (clearBtn) {
    clearBtn.addEventListener('click', clearContent);
  }

  if (openFileBtn) {
    openFileBtn.addEventListener('click', () => {
      if (generatedFilePath) {
        ipc.send('open-file', { filePath: generatedFilePath });
      }
    });
  }

  if (showInFolderBtn) {
    showInFolderBtn.addEventListener('click', () => {
      if (generatedFilePath) {
        ipc.send('show-in-folder', { filePath: generatedFilePath });
      }
    });
  }

  if (openSendToKindleBtn) {
    openSendToKindleBtn.addEventListener('click', () => {
      ipc.send('open-send-to-kindle');
      showStatus('Opening Send to Kindle...', 'info', 3000);
    });
  }

  // Enable generate button and add event listener
  if (generateKindleBtn) {
    generateKindleBtn.addEventListener('click', () => {
      if (uploadedFiles.length > 0 && !isProcessing) {
        processSelectedFiles();
      }
    });
  }

  // Format selection listener
  if (formatOptions) {
    formatOptions.forEach(option => {
      option.addEventListener('change', () => {
        selectedFormat = document.querySelector('input[name="format"]:checked')?.value || 'auto';
        console.log(`[Renderer] Format changed to: ${selectedFormat}`);

        // Update button state if we have files
        if (uploadedFiles.length > 0) {
          updateGenerateButtonState(true);
        }
      });
    });
  }

  // Template dialog listeners
  if (templateConfirmBtn) {
    templateConfirmBtn.addEventListener('click', () => {
      const selectedTemplateValue = templateSelector.value;

      // Store selected template (or null for auto)
      selectedTemplate = selectedTemplateValue === 'auto' ? null : selectedTemplateValue;

      // Close dialog
      templateDialog.classList.remove('active');

      // Proceed with file processing
      processSelectedFiles();
    });
  }

  if (templateCancelBtn) {
    templateCancelBtn.addEventListener('click', () => {
      // Reset template selection
      if (templateSelector) templateSelector.value = 'auto';
      selectedTemplate = null;

      // Close dialog
      templateDialog.classList.remove('active');

      // Proceed with file processing
      processSelectedFiles();
    });
  }

  // Template selector change handler to update preview
  if (templateSelector) {
    templateSelector.addEventListener('change', updateTemplatePreview);
  }
}

// Add a file picker button to the UI
function addFilePicker() {
  // Create a file picker button if it doesn't exist
  if (!document.getElementById('file-picker-btn')) {
    const pickerBtn = document.createElement('button');
    pickerBtn.id = 'file-picker-btn';
    pickerBtn.className = 'secondary-btn';
    pickerBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 5px; vertical-align: text-bottom;"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg> Select Files';
    pickerBtn.style.marginRight = '10px';
    
    // Add click handler for the file picker
    pickerBtn.addEventListener('click', openFilePicker);
    
    // Add the button to the actions section
    const actionsDiv = document.querySelector('.actions');
    if (actionsDiv) {
      actionsDiv.insertBefore(pickerBtn, actionsDiv.firstChild);
    }
  }
}

// Open the native file dialog
function openFilePicker() {
  if (isProcessing) return;
  
  if (dialog && typeof dialog.showOpenDialog === 'function') {
    dialog.showOpenDialog({
      title: 'Select Email or PDF Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Email & PDF Files', extensions: ['eml', 'pdf'] },
        { name: 'Email Files', extensions: ['eml'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        handleFileSelection(result.filePaths);
      }
    }).catch(err => {
      console.error('[Renderer] Dialog error:', err);
      showStatus('Error opening file picker dialog', 'error');
      
      // Fall back to regular file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.eml,.pdf';
      input.multiple = true;
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleFileDrop(e.target.files);
        }
      });
      input.click();
    });
  } else {
    console.log('[Renderer] Native dialog not available, using file input');
    // Fall back to regular file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.eml,.pdf';
    input.multiple = true;
    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileDrop(e.target.files);
      }
    });
    input.click();
  }
}

// Process selected files
function processSelectedFiles() {
  if (uploadedFiles.length === 0) {
    showStatus('No files to process', 'error');
    return;
  }
  
  console.log('[Renderer] Processing selected files:', uploadedFiles);
  
  // Show processing state
  isProcessing = true;
  dropZone.classList.add('processing');
  updateGenerateButtonState(false);
  
  // Get format and template preferences
  const formatPreference = selectedFormat || document.querySelector('input[name="format"]:checked')?.value || 'auto';
  
  // Send to main process
  ipc.send('process-dropped-files', {
    paths: uploadedFiles,
    formatPreference: formatPreference,
    selectedTemplate: selectedTemplate
  });
  
  showStatus(`Processing ${uploadedFiles.length} file(s)...`, 'info');
  
  // Start progress animation
  startProgressAnimation();
}

// Handle files selected via dialog
function handleFileSelection(filePaths) {
  console.log('[Renderer] Files selected via dialog:', filePaths);
  
  if (!filePaths || filePaths.length === 0) {
    showStatus('No files selected', 'info');
    return;
  }
  
  // Store the selected files
  uploadedFiles = filePaths;
  
  // Update UI to reflect files are ready to process
  updateGenerateButtonState(true);
  
  // Update the drop zone to show selected files
  const uploadContent = dropZone.querySelector('.upload-content');
  if (uploadContent) {
    uploadContent.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#26de81" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <h2>${filePaths.length} ${filePaths.length === 1 ? 'File' : 'Files'} Selected</h2>
      <p>Click "Generate Kindle Ebook" to convert ${filePaths.length === 1 ? 'this file' : 'these files'}</p>
    `;
  }
  
  // Also update preview panel
  if (previewPanel) {
    previewPanel.innerHTML = `
      <div class="preview-content">
        <h3>Files Ready to Process</h3>
        <ul style="list-style-type: none; padding: 0;">
          ${filePaths.map(file => `
            <li style="margin: 8px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0366d6" stroke-width="2" style="margin-right: 5px; vertical-align: text-bottom;">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              ${path.basename(file)}
              <span style="float: right; color: #666; font-size: 12px;">${path.extname(file).toLowerCase()}</span>
            </li>
          `).join('')}
        </ul>
        <p>Click "Generate Kindle Ebook" to convert these files.</p>
      </div>
    `;
  }
  
  showStatus(`${filePaths.length} ${filePaths.length === 1 ? 'file' : 'files'} selected`, 'success');
}

// Handle files dropped onto the application
function handleFileDrop(files) {
  console.log('[Renderer] Handling dropped files:', files);
  
  if (!files || files.length === 0) {
    console.error('[Renderer] No files to process');
    showStatus('No files to process', 'error');
    return;
  }
  
  // Extract file paths
  const filePaths = [];
  const fileList = Array.from(files); // Convert to array if it's a FileList
  
  fileList.forEach(file => {
    // In Electron, the file should have a path property
    if (file.path) {
      filePaths.push(file.path);
    } 
    // Handle string paths directly
    else if (typeof file === 'string') {
      filePaths.push(file);
    }
    // For Electron's drag events that have files in dataTransfer
    else if (file.name && typeof file === 'object') {
      // If we're in Electron but don't have a path property,
      // log this unusual situation for debugging
      console.log('[Renderer] File object without path:', file);
      
      // For debugging - log what properties are available
      console.log('[Renderer] Available file properties:', Object.keys(file));
      
      // Check if we have a name at least
      if (file.name) {
        showStatus('File detected, but path information is restricted. Try using the file picker instead.', 'info');
      }
    }
    // For anything else, provide helpful debug information
    else {
      console.error('[Renderer] Unhandled file type:', typeof file, file);
    }
  });
  
  if (filePaths.length === 0) {
    console.error('[Renderer] No valid file paths found');
    showStatus('No valid file paths found. Try using the file picker button instead.', 'error');
    return;
  }
  
  console.log('[Renderer] Sending file paths to main process:', filePaths);
  
  // Store files for potential reprocessing
  uploadedFiles = filePaths;
  
  // Make sure we're sending an array of paths
  ipc.send('process-dropped-files', { 
    paths: filePaths,
    formatPreference: selectedFormat || 'auto',
    selectedTemplate: selectedTemplate || null
  });
  
  // Show processing indication
  dropZone.classList.add('processing');
  isProcessing = true;
  updateGenerateButtonState(false);
  showStatus(`Processing ${filePaths.length} file(s)...`, 'info');
  
  // Start progress animation
  startProgressAnimation();
}

// Handle files selected for processing
function handleSelectedFiles(files) {
  if (!files || files.length === 0) return;

  const filePaths = [];
  for (const file of files) {
    let filePath = '';

    if (typeof file === 'object' && file.path) {
      filePath = file.path;
    } else if (typeof file === 'string') {
      filePath = file;
    }

    if (filePath) {
      filePaths.push(filePath);
    }
  }

  if (filePaths.length === 0) {
    showStatus('No valid files found', 'error');
    return;
  }
  
  // Store for processing
  uploadedFiles = filePaths;
  
  // Update UI to show files are ready
  updateGenerateButtonState(true);
  showStatus(`${filePaths.length} file(s) ready to process`, 'success');
  
  // Update preview panel
  previewPanel.innerHTML = `
    <div class="preview-content">
      <h3>Files Ready to Process</h3>
      <ul style="list-style-type: none; padding: 0;">
        ${filePaths.map(file => `
          <li style="margin: 8px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0366d6" stroke-width="2" style="margin-right: 5px; vertical-align: text-bottom;">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            ${path.basename(file)}
            <span style="float: right; color: #666; font-size: 12px;">${path.extname(file).toLowerCase()}</span>
          </li>
        `).join('')}
      </ul>
      <p>Click "Generate Kindle Ebook" to convert these files.</p>
    </div>
  `;
}

// Drag & Drop Setup
function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  dropZone.addEventListener('dragenter', (e) => {
    console.log('[Renderer] Drag enter event');
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    console.log('[Renderer] Drag leave event');
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    console.log('[Renderer] Drop event');
    dropZone.classList.remove('drag-over');
    
    // Use the handleFileDrop function
    handleFileDrop(e.dataTransfer.files);
  });

  dropZone.addEventListener('click', () => {
    if (isProcessing) return;
    
    // Use the native file picker if available
    openFilePicker();
  });
}

// Update progress indicator with actual percentage
function updateProgressDisplay(percentage, status) {
  console.log(`[Renderer] Updating progress display: ${percentage}%, status: ${status}`);

  // Update spinner
  const spinner = document.querySelector('.spinner');
  if (spinner) {
    spinner.setAttribute('data-progress', `${percentage}%`);
    // This sets a CSS variable needed for the visual indicator
    spinner.style.setProperty('--progress', `${percentage}%`);
  }

  // Update progress bar if it exists
  const progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
    progressBar.textContent = `${percentage}%`;
  }

  // Update status message if it exists
  const processingStatus = document.getElementById('processing-status');
  if (processingStatus && status) {
    processingStatus.textContent = status;
  }

  // Ensure processing state is maintained
  if (percentage < 100) {
    dropZone.classList.add('processing');
    isProcessing = true;
  }
}

// Update generate button state
function updateGenerateButtonState(enabled) {
  if (generateKindleBtn) {
    generateKindleBtn.disabled = !enabled;
    generateKindleBtn.style.opacity = enabled ? '1' : '0.4';
    generateKindleBtn.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

// Show template confirmation dialog
function showTemplateConfirmation(info) {
  if (!templateDialog || !detectedName || !detectedType || !detectedConfidence || !templateSelector) {
    console.error("[Renderer] Template dialog elements not found");
    processSelectedFiles();
    return;
  }

  // Fill in newsletter info
  detectedName.textContent = info.name || 'Newsletter';
  detectedType.textContent = capitalizeFirstLetter(info.type || 'generic');
  detectedConfidence.textContent = `${info.confidence}%`;

  // Set selector to detected type
  templateSelector.value = info.type || 'generic';

  // Update preview based on detected type
  updateTemplatePreview();

  // Show dialog
  templateDialog.classList.add('active');
}

// Update template preview based on selection
function updateTemplatePreview() {
  if (!templatePreview || !templateSelector) {
    return;
  }

  const selectedType = templateSelector.value;

  // Remove existing template classes
  templatePreview.className = '';

  // Add class for selected template
  templatePreview.classList.add(`template-${selectedType === 'auto' ?
    (detectedNewsletterInfo?.type || 'generic') : selectedType}`);

  // Update content based on template type
  switch(selectedType === 'auto' ? (detectedNewsletterInfo?.type || 'generic') : selectedType) {
    case 'stratechery':
      templatePreview.innerHTML = `
        <p class="template-example">This newsletter will be formatted with Stratechery's template.</p>
        <p class="template-example">Paragraphs will have proper text indentation and spacing optimized for reading analysis pieces.</p>
        <blockquote class="template-example">Quotes will be properly formatted with left borders and italics.</blockquote>
      `;
      break;
    case 'substack':
      templatePreview.innerHTML = `
        <p class="template-example">This newsletter will use Substack's clean format.</p>
        <p class="template-example">Paragraphs will have proper spacing and readability enhancements for long-form content.</p>
        <blockquote class="template-example">Quotes and references will be styled appropriately.</blockquote>
      `;
      break;
    case 'axios':
      templatePreview.innerHTML = `
        <p class="template-example">Axios formatting will be applied.</p>
        <p class="template-example">• Bullet points will be formatted properly</p>
        <p class="template-example">• "Go deeper" sections will have special styling</p>
        <blockquote class="template-example">Quotes will be properly formatted.</blockquote>
      `;
      break;
    case 'bulletinmedia':
      templatePreview.innerHTML = `
        <p class="template-example">Bulletin Media formatting will be applied.</p>
        <p class="template-example">Headlines and briefs will be properly formatted.</p>
        <p class="template-example"><span style="font-style: italic; font-size: 0.9em; color: #666;">Source information will be formatted like this.</span></p>
      `;
      break;
    case 'onetech':
    case 'jeffselingo':
      templatePreview.innerHTML = `
        <p class="template-example">Newsletter specific formatting will be applied.</p>
        <p class="template-example">Paragraphs, sections, and quotes will be formatted for optimal reading on Kindle.</p>
        <blockquote class="template-example">Quotes and references will be styled appropriately.</blockquote>
      `;
      break;
    default: // generic
      templatePreview.innerHTML = `
        <p class="template-example">Generic newsletter formatting will be applied.</p>
        <p class="template-example">This provides clean, readable formatting for all newsletter types.</p>
        <blockquote class="template-example">Quotes and references will be properly styled.</blockquote>
      `;
  }
}

// Preview updates
function updatePreviewWithSuccess(result) {
  const formatName = result.formatName || result.format?.toUpperCase() || 'EPUB';

  // Create additional files section if we have multiple files
  let additionalFilesSection = '';
  if (result.additionalFiles && result.additionalFiles.length > 0) {
    additionalFilesSection = `
      <div class="additional-files">
        <h3>Additional Files</h3>
        <ul>
          ${result.additionalFiles.map(file => `<li>${path.basename(file)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // Add template info if available
  let templateInfoSection = '';
  if (detectedNewsletterInfo && detectedNewsletterInfo.type && detectedNewsletterInfo.type !== 'generic') {
    templateInfoSection = `
      <div class="template-info">
        <div class="template-info-title">
          Template: ${capitalizeFirstLetter(selectedTemplate || detectedNewsletterInfo.type)}
          <span class="template-badge">${detectedNewsletterInfo.confidence}% match</span>
        </div>
        <div class="template-description">
          Optimized formatting has been applied for this newsletter type.
        </div>
      </div>
    `;
  }

  previewPanel.innerHTML = `
    <div class="kindle-preview">
      <h2>${formatName} Generated Successfully</h2>
      <p class="email-date">Saved to: ${result.filePath}</p>
      <div class="preview-summary">
        <p>Your content has been converted and is ready for your Kindle.</p>
        <p>Use the buttons on the left to open the ${formatName} or locate it in your folder.</p>
      </div>
      ${templateInfoSection}
      ${additionalFilesSection}
      <div class="preview-note">
        <p>For the best reading experience, send this file to your Kindle device.</p>
        <p>${formatName} format provides better text reflowing, font adjustments, and Kindle navigation features.</p>
      </div>
    </div>
  `;
}

function updatePreviewWithContent(data) {
  if (!data) return;

  let contentHtml = '';
  let contentType = '';

  // Create a title from the subject
  const title = data.subject || 'Content';

  // Add content type badge
  let typeBadge = '';

  if (data.newsletterType === 'pdf') {
    typeBadge = `<div style="display: inline-block; background-color: #e74c3c; color: white;
                 padding: 4px 8px; border-radius: 4px; font-size: 12px;
                 margin-left: 10px; vertical-align: middle;">
                 PDF
                 </div>`;
    contentType = 'PDF Document';
  } else if (data.newsletterType === 'mixed') {
    typeBadge = `<div style="display: inline-block; background-color: #9b59b6; color: white;
                 padding: 4px 8px; border-radius: 4px; font-size: 12px;
                 margin-left: 10px; vertical-align: middle;">
                 Mixed Content
                 </div>`;
    contentType = 'Mixed Content Collection';
  } else if (data.newsletterType && data.newsletterType !== 'generic') {
    typeBadge = `<div style="display: inline-block; background-color: #0366d6; color: white;
                 padding: 4px 8px; border-radius: 4px; font-size: 12px;
                 margin-left: 10px; vertical-align: middle;">
                 ${capitalizeFirstLetter(data.newsletterType)}
                 </div>`;
    contentType = 'Newsletter';
  } else {
    contentType = 'Content';
  }

  // Use the HTML content if available, otherwise use the text content
  if (data.html) {
    // Create a sanitized version of the HTML
    contentHtml = cleanupHtmlForPreview(data.html);
  } else if (data.text) {
    // Convert text content to HTML for display
    contentHtml = `<pre style="white-space: pre-wrap; font-family: inherit;">${data.text}</pre>`;
  } else {
    contentHtml = '<p>No content available to preview.</p>';
  }

  // Template info section if newsletter type detected
  let templateInfoSection = '';
  if (data.newsletterType && data.newsletterType !== 'generic' &&
      data.newsletterType !== 'pdf' && data.newsletterType !== 'mixed') {
    templateInfoSection = `
      <div class="template-info">
        <div class="template-info-title">
          Template: ${capitalizeFirstLetter(selectedTemplate || data.newsletterType)}
          <span class="template-badge">Detected</span>
        </div>
        <div class="template-description">
          Optimized formatting will be applied for this newsletter type.
        </div>
      </div>
    `;
  }

  // Create preview with additional info about the type
  previewPanel.innerHTML = `
    <div class="kindle-preview">
      <h2>${escapeHtml(title)} ${typeBadge}</h2>
      ${data.date ? `<p class="email-date">${data.date}</p>` : ''}
      ${data.from ? `<p class="email-from" style="text-align: center; color: #666; font-style: italic;">${escapeHtml(data.from)}</p>` : ''}
      ${templateInfoSection}
      <div class="preview-html-content">
        ${contentHtml}
      </div>
      <div class="content-info" style="margin-top: 20px; padding: 15px; background-color: #f6f8fa; border-radius: 8px;">
        <h3 style="margin-top: 0;">${contentType} Formatting</h3>
        <p>Content was detected as: <strong>${capitalizeFirstLetter(data.newsletterType || 'generic')}</strong></p>
        <p>Custom Kindle-optimized formatting will be applied for the best reading experience.</p>
        <p>The ${generatedFileFormat.toUpperCase()} format will provide reflowable text, adjustable fonts, and better navigation on your Kindle.</p>
      </div>
    </div>
  `;
}

// Add a function to animate the progress
function startProgressAnimation() {
  // Clear any existing interval
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  let progress = 0;
  const progressBar = document.getElementById('progress-bar');
  const processingStatus = document.getElementById('processing-status');
  const spinner = document.querySelector('.spinner');

  // Make sure progress display elements exist
  if (!progressBar && !spinner) {
    console.error('[Renderer] Progress elements not found, cannot show animation');
    return;
  }

  // Set initial values
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';
  }

  if (spinner) {
    spinner.setAttribute('data-progress', '0%');
    // Set the CSS variable for the spinner
    spinner.style.setProperty('--progress', '0%');
  }

  let lastUpdateTime = Date.now();
  progressInterval = setInterval(() => {
    // Only update if we're still processing
    if (!isProcessing) {
      clearInterval(progressInterval);
      progressInterval = null;
      return;
    }

    const currentTime = Date.now();
    const timeSinceLastUpdate = currentTime - lastUpdateTime;

    // Increment progress slowly, but never reach 100%
    // Use a variable increment rate that slows down as we approach higher percentages
    let increment = 0.5;

    // Slow down the progress as we get higher to prevent it from reaching 100% too quickly
    if (progress > 30 && progress < 60) {
      increment = 0.3;
    } else if (progress >= 60 && progress < 80) {
      increment = 0.2;
    } else if (progress >= 80) {
      increment = 0.1;
    }

    // Only update progress if enough time has passed (creates smoother animation)
    if (timeSinceLastUpdate >= 100) {
      progress += increment;
      lastUpdateTime = currentTime;
    }

    // Cap progress at 95% (we'll jump to 100% when actually complete)
    progress = Math.min(progress, 95);

    // Update display
    updateProgressDisplay(Math.round(progress), getStatusForProgress(progress));
  }, 100); // Update every 100ms

  // Add a timeout to prevent spinning forever if something goes wrong
  setTimeout(() => {
    if (isProcessing && progress < 90) {
      console.log('[Renderer] Progress timeout reached, forcing error state');
      // Force error state after 2 minutes if still processing
      if (progressBar) {
        progressBar.style.backgroundColor = '#f44336';
      }
      if (processingStatus) {
        processingStatus.textContent = "Processing is taking longer than expected. There might be an issue.";
      }
    }
  }, 120000); // 2 minutes timeout
}

// Get appropriate status message based on progress percentage
function getStatusForProgress(progress) {
  if (progress < 20) {
    return "Initializing...";
  } else if (progress >= 20 && progress < 40) {
    return "Parsing email content...";
  } else if (progress >= 40 && progress < 60) {
    return "Formatting content for e-reader...";
  } else if (progress >= 60 && progress < 80) {
    return "Generating ebook files...";
  } else if (progress >= 80) {
    return "Finalizing your ebook...";
  }
  return "Processing...";
}

// Utilities
function clearContent(updateUI = true) {
  console.log('[Renderer] Clearing content');
  uploadedFiles = [];
  generatedFilePath = null;
  additionalGeneratedFiles = [];
  detectedNewsletterInfo = null;
  selectedTemplate = null;
  isProcessing = false; // Important: reset processing state

  // Clear progress animation interval if it exists
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  // Reset drop zone classes
  dropZone.classList.remove('processing', 'processed', 'drag-over');

  // Reset all content to initial state
  const uploadContent = dropZone.querySelector('.upload-content');
  const processingContent = dropZone.querySelector('.processing-content');
  const successContent = dropZone.querySelector('.success-content');

  if (uploadContent) uploadContent.style.display = 'flex';
  if (processingContent) processingContent.style.display = 'none';
  if (successContent) successContent.style.display = 'none';

  if (updateUI) {
    previewPanel.innerHTML = '<div class="placeholder-message">Drop email (.eml) or PDF files to begin</div>';
    showStatus('Ready', 'info');
    openFileBtn.disabled = true;
    showInFolderBtn.disabled = true;
    if (openSendToKindleBtn) openSendToKindleBtn.disabled = true;
    updateGenerateButtonState(false);
  }

  // Re-enable drop zone
  dropZone.style.pointerEvents = 'auto';
}

function showStatus(msg, type = 'info', timeout = 4000) {
  console.log(`[Renderer] Status message: ${msg} (${type})`);
  statusMessage.innerText = msg;
  statusMessage.className = `status-message status-${type}`;
  statusMessage.classList.remove('status-hidden');
  if (timeout) {
    setTimeout(() => {
      statusMessage.classList.add('status-hidden');
    }, timeout);
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function capitalizeFirstLetter(string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function cleanupHtmlForPreview(html) {
  if (!html) return '';

  try {
    // Create a temporary div to parse and clean the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Define images variable
    const images = tempDiv.querySelectorAll('img');

    images.forEach(img => {
      // Handle images that might not load in the preview
      img.onerror = () => {
        img.style.display = 'none';
      };

      // Make sure images aren't too large for the preview
      img.style.maxWidth = '100%';
      img.style.height = 'auto';

      // Fix data-src attributes that are common in newsletters
      if (img.hasAttribute('data-src') && !img.getAttribute('src')) {
        img.src = img.getAttribute('data-src');
      }

      // Handle cid: references in a basic way
      if (img.src && img.src.startsWith('cid:')) {
        img.style.border = '1px dashed #ccc';
        img.style.padding = '8px';
        img.style.backgroundColor = '#f8f8f8';
        img.alt = 'Embedded Image';
      }
    });

    return tempDiv.innerHTML;
  } catch (error) {
    console.error('[Renderer] Error cleaning HTML for preview:', error);
    return `<p>Error displaying HTML content: ${error.message}</p>`;
  }
}

// Global error handler
window.addEventListener('error', function(event) {
  console.error('[Renderer] Unhandled error:', event.error);
  showStatus(`Unhandled error: ${event.error?.message || 'Unknown error'}`, 'error', 10000);
});