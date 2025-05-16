// utils/enhanced-renderer.js
const { ipcRenderer } = require('electron');
const marked = require('marked');
const TurndownService = require('turndown');
const turndownService = new TurndownService();
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// NEW: Format Selection
const formatOptions = document.querySelectorAll('input[name="format"]');

// NEW: Template Dialog Elements
const templateDialog = document.getElementById('template-dialog');
const detectedName = document.getElementById('detected-name');
const detectedType = document.getElementById('detected-type').querySelector('span');
const detectedConfidence = document.getElementById('detected-confidence').querySelector('span');
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
let detectedNewsletterInfo = null; // NEW: Store detected newsletter info
let selectedTemplate = null; // NEW: Store selected template
let selectedFormat = 'auto'; // NEW: Store selected format
let progressInterval = null; // NEW: Store progress animation interval

// Init
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupDragAndDrop();

  console.log('Renderer initialized');

  // Set initial output path display
  const userHome = require('os').homedir();
  const downloadDir = path.join(userHome, 'Downloads', 'kindle-books');
  outputPathDisplay.textContent = downloadDir;

  // Set initial selected format
  selectedFormat = document.querySelector('input[name="format"]:checked').value || 'auto';
  console.log(`Initial format selected: ${selectedFormat}`);

  // Update button text to reflect ebook format
  if (openFileBtn) {
    openFileBtn.textContent = 'Open Ebook';
  }

  // Update generate button text if it exists
  if (generateKindleBtn) {
    generateKindleBtn.textContent = 'Generate Kindle Ebook';
  }

  // Update drop zone text to include PDF files
  const dropZoneTitle = document.querySelector('.eml-drop-zone h2');
  if (dropZoneTitle) {
    dropZoneTitle.textContent = 'Drop Email or PDF Files Here';
  }

  const dropZoneDescription = document.querySelector('.eml-drop-zone p');
  if (dropZoneDescription) {
    dropZoneDescription.textContent = 'Drop one or multiple email newsletter (.eml) or PDF files to convert for Kindle';
  }
});

// Event Listeners
function setupEventListeners() {
  clearBtn.addEventListener('click', clearContent);

  openFileBtn.addEventListener('click', () => {
    if (generatedFilePath) {
      ipcRenderer.send('open-file', { filePath: generatedFilePath });
    }
  });

  showInFolderBtn.addEventListener('click', () => {
    if (generatedFilePath) {
      ipcRenderer.send('show-in-folder', { filePath: generatedFilePath });
    }
  });

  if (openSendToKindleBtn) {
    openSendToKindleBtn.addEventListener('click', () => {
      ipcRenderer.send('open-send-to-kindle');
      showStatus('Opening Send to Kindle...', 'info', 3000);
    });
  }

  // Enable generate button and add event listener
  if (generateKindleBtn) {
    generateKindleBtn.addEventListener('click', () => {
      if (uploadedFiles.length > 0 && !isProcessing) {
        processDroppedFiles();
      }
    });
  }

  // NEW: Format selection listener (updated)
  formatOptions.forEach(option => {
    option.addEventListener('change', () => {
      selectedFormat = document.querySelector('input[name="format"]:checked').value;
      console.log(`Format changed to: ${selectedFormat}`);

      // Update button state if we have files
      if (uploadedFiles.length > 0) {
        updateGenerateButtonState(true);
      }
    });
  });

  // NEW: Template dialog listeners
  templateConfirmBtn.addEventListener('click', () => {
    const selectedTemplateValue = templateSelector.value;

    // Store selected template (or null for auto)
    selectedTemplate = selectedTemplateValue === 'auto' ? null : selectedTemplateValue;

    // Close dialog
    templateDialog.classList.remove('active');

    // Proceed with file processing
    processDroppedFiles();
  });

  templateCancelBtn.addEventListener('click', () => {
    // Reset template selection
    templateSelector.value = 'auto';
    selectedTemplate = null;

    // Close dialog
    templateDialog.classList.remove('active');

    // Proceed with file processing
    processDroppedFiles();
  });

  // Template selector change handler to update preview
  templateSelector.addEventListener('change', updateTemplatePreview);

  // Listen for file operation results
  ipcRenderer.on('file-operation-result', (event, result) => {
    if (!result.success) {
      showStatus(`Operation failed: ${result.error}`, 'error', 5000);
    }
  });

  // Listen for file dropped event from main process
  ipcRenderer.on('file-dropped', (event, filePaths) => {
    console.log('Received file-dropped event:', filePaths);
    if (Array.isArray(filePaths) && filePaths.length > 0) {
      handleSelectedFiles(filePaths.map(path => ({ path })));
    } else {
      console.error('Invalid file paths received in file-dropped event:', filePaths);
      showStatus('Error: Invalid file paths received. Please try again.', 'error', 5000);
    }
  });

  // NEW: Newsletter info event listener
  ipcRenderer.on('newsletter-info', (event, info) => {
    console.log('Received newsletter-info event:', info);
    if (info && info.type) {
      // Store newsletter info
      detectedNewsletterInfo = info;

      // Show template confirmation dialog
      showTemplateConfirmation(info);
    } else {
      // If no newsletter info or generic type, proceed with default
      processDroppedFiles();
    }
  });

  // NEW: Progress update event listener
  ipcRenderer.on('progress-update', (event, data) => {
    console.log('Received progress update:', data);
    updateProgressDisplay(data.percentage, data.status);
  });

  // Updated event name to match main.js
  ipcRenderer.on('ebook-generated', (event, result) => {
    console.log('Received ebook-generated event:', result);
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
          processDroppedFiles(); // Retry with the same files
        });
      }
    }

    // Always re-enable the generate button if we have files
    updateGenerateButtonState(uploadedFiles.length > 0);
  });

  ipcRenderer.on('error', (event, message) => {
    showStatus(`Error: ${message}`, 'error', 5000);
  });
}

// NEW: Update progress indicator with actual percentage
function updateProgressDisplay(percentage, status) {
  console.log(`Updating progress display: ${percentage}%, status: ${status}`);

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

// NEW: Update generate button state
function updateGenerateButtonState(enabled) {
  if (generateKindleBtn) {
    generateKindleBtn.disabled = !enabled;
    generateKindleBtn.style.opacity = enabled ? '1' : '0.4';
    generateKindleBtn.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

// NEW: Show template confirmation dialog
function showTemplateConfirmation(info) {
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

// NEW: Update template preview based on selection
function updateTemplatePreview() {
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

function updatePreviewWithSuccess(result) {
  const formatName = result.formatName || result.format.toUpperCase() || 'EPUB';

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

  // NEW: Add template info if available
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

  // NEW: Template info section if newsletter type detected
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
    console.error('Error cleaning HTML for preview:', error);
    return `<p>Error displaying HTML content: ${error.message}</p>`;
  }
}

// File Handling
function handleSelectedFiles(files) {
  if (!files || files.length === 0) return;

  const filePaths = [];
  for (const file of files) {
    let filePath = '';

    if (file instanceof File) {
      filePath = file.path;
    } else if (typeof file === 'string') {
      filePath = file;
    }

    if (filePath) {
      let cleanPath = filePath.trim();

      if (cleanPath.startsWith('file://')) {
        cleanPath = decodeURIComponent(cleanPath.replace(/^file:\/\//, '')).trim();
      } else {
        cleanPath = decodeURIComponent(cleanPath).trim();
      }

      filePaths.push(cleanPath);
    }
  }

  console.log('[Renderer] Cleaned file paths:', filePaths);
  ipcRenderer.send('process-dropped-files', { paths: filePaths });
}

// NEW: Process dropped files with current settings
function processDroppedFiles(customFilePaths) {
  // Use stored paths if not provided
  const filePaths = Array.isArray(customFilePaths) ? customFilePaths : uploadedFiles;

  if (!filePaths || filePaths.length === 0) {
    showStatus('No files to process', 'error');
    return;
  }

  console.log('Processing files:', filePaths);

  // Set processing state
  isProcessing = true;
  dropZone.classList.add('processing');
  updateGenerateButtonState(false);

  // Reset progress indicators
  updateProgressDisplay(0, 'Initializing...');

  // Show processing spinner and progress bar
  previewPanel.innerHTML = `
    <div class="kindle-preview">
      <h2>Processing Files</h2>
      <div class="processing-spinner" style="text-align: center; margin: 20px 0;">
        <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
      </div>
      <p id="processing-status" style="text-align:center; font-size:14px; color:#555;">Initializing conversion for ${filePaths.length} file(s)...</p>
      <div id="processing-progress" style="width: 100%; background-color: #f3f3f3; border-radius: 4px; margin-top: 15px;">
        <div id="progress-bar" style="width: 0%; height: 20px; background-color: #4CAF50; border-radius: 4px; text-align: center; line-height: 20px; color: white;">0%</div>
      </div>
      <div id="processing-notes" style="margin-top: 20px; padding: 10px; background-color: #f8f8f8; border-radius: 4px;">
        <p><strong>Note:</strong> <span id="processing-message">Processing can take several minutes for large files or multiple newsletters.</span></p>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;

  // Start the progress animation
  startProgressAnimation();

  // Get the selected format
  const formatPreference = selectedFormat || document.querySelector('input[name="format"]:checked').value || 'auto';
  console.log(`Processing with format preference: ${formatPreference}`);

  // Send the file paths and preferences to be processed
  ipcRenderer.send('process-dropped-files', {
    paths: filePaths,
    formatPreference: formatPreference,
    selectedTemplate: selectedTemplate
  });

  // Save files for potential reprocessing
  if (!customFilePaths) {
    uploadedFiles = filePaths;
  }

  showStatus(`Processing ${filePaths.length} file(s)...`, 'info');
}

// Add a function to animate the progress even when we don't have actual progress data
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
  if (!progressBar || !processingStatus) {
    console.error('Progress elements not found, cannot show animation');
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
      console.log('Progress timeout reached, forcing error state');
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

// Drag & Drop Setup
function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  dropZone.addEventListener('dragenter', (e) => {
    console.log('Drag enter event');
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', (e) => {
    console.log('Drag leave event');
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    console.log('Drop event:', e.dataTransfer.files);
    dropZone.classList.remove('drag-over');
    handleSelectedFiles(e.dataTransfer.files);
  });

  dropZone.addEventListener('click', () => {
    if (isProcessing) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.eml,.pdf';
    input.multiple = true;
    input.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSelectedFiles(e.target.files);
      }
    });
    input.click();
  });
}

// Utilities
function clearContent(updateUI = true) {
  console.log('Clearing content');
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
  console.log(`Status message: ${msg} (${type})`);
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

// Add a global error handler to catch and display unhandled errors
window.addEventListener('error', function(event) {
  console.error('Unhandled error:', event.error);
  showStatus(`Unhandled error: ${event.error?.message || 'Unknown error'}`, 'error', 10000);
});

// NEW: Handle file drop
function handleFileDrop(paths) {
  console.log('[Renderer] Received file paths:', paths, 'Type:', typeof paths);

  // Validate that paths is an array
  if (!Array.isArray(paths)) {
    console.error('[Renderer] Invalid file paths:', paths);
    showStatus('Error: Invalid file paths received. Please try again.', 'error', 5000);
    return;
  }

  // Send valid paths to the main process
  ipcRenderer.send('process-dropped-files', { paths });
}

// Export the module
module.exports = {
  handleSelectedFiles,
  processDroppedFiles,
  clearContent,
  updateProgressDisplay,
  showStatus
};
