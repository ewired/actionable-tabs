// DOM elements
const autoMoveCheckbox = document.getElementById('autoMove');
const moveOnActivationCheckbox = document.getElementById('moveOnActivation');
const showNotificationsCheckbox = document.getElementById('showNotifications');
const saveButton = document.getElementById('saveButton');
const resetButton = document.getElementById('resetButton');
const statusMessage = document.getElementById('statusMessage');
const pinnedCountSpan = document.getElementById('pinnedCount');
const totalCountSpan = document.getElementById('totalCount');

// Default settings
const DEFAULT_SETTINGS = {
  autoMove: false,
  moveOnActivation: false,
  showNotifications: true
};

// Load settings when page opens
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateTabCounts();
});

/**
 * Load settings from storage and update UI
 */
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    
    autoMoveCheckbox.checked = settings.autoMove;
    moveOnActivationCheckbox.checked = settings.moveOnActivation;
    showNotificationsCheckbox.checked = settings.showNotifications;
    
    console.log('Settings loaded:', settings);
  } catch (error) {
    showStatus('Error loading settings: ' + error.message, 'error');
    console.error('Error loading settings:', error);
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  const settings = {
    autoMove: autoMoveCheckbox.checked,
    moveOnActivation: moveOnActivationCheckbox.checked,
    showNotifications: showNotificationsCheckbox.checked
  };
  
  try {
    await chrome.storage.sync.set(settings);
    showStatus('Settings saved successfully!', 'success');
    console.log('Settings saved:', settings);
    
    // Update tab counts after save
    await updateTabCounts();
  } catch (error) {
    showStatus('Error saving settings: ' + error.message, 'error');
    console.error('Error saving settings:', error);
  }
}

/**
 * Reset settings to defaults
 */
async function resetSettings() {
  try {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await loadSettings();
    showStatus('Settings reset to defaults', 'success');
    console.log('Settings reset to defaults');
  } catch (error) {
    showStatus('Error resetting settings: ' + error.message, 'error');
    console.error('Error resetting settings:', error);
  }
}

/**
 * Update the displayed tab counts
 */
async function updateTabCounts() {
  try {
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const pinnedTabs = allTabs.filter(tab => tab.pinned);
    
    pinnedCountSpan.textContent = pinnedTabs.length;
    totalCountSpan.textContent = allTabs.length;
  } catch (error) {
    pinnedCountSpan.textContent = 'Error';
    totalCountSpan.textContent = 'Error';
    console.error('Error updating tab counts:', error);
  }
}

/**
 * Show status message to user
 * @param {string} message - The message to display
 * @param {string} type - 'success' or 'error'
 */
function showStatus(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  
  // Clear message after 3 seconds
  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = 'status-message';
  }, 3000);
}

// Event listeners
saveButton.addEventListener('click', saveSettings);
resetButton.addEventListener('click', resetSettings);

// Auto-save on checkbox change (optional - can be removed if you want manual save only)
[autoMoveCheckbox, moveOnActivationCheckbox, showNotificationsCheckbox].forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    showStatus('Change detected - click Save to apply', 'info');
  });
});