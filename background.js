// Initialize extension on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Actionable Tabs extension installed');
  
  // Create context menu items on the browser action
  createContextMenus();
  
  // Set default settings if not already set
  initializeDefaultSettings();
});

// Create context menu items
function createContextMenus() {
  // Remove existing menus to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Main action menu item
    chrome.contextMenus.create({
      id: 'move-past-pinned',
      title: 'Move Current Tab Past Pinned Tabs',
      contexts: ['action']
    });
    
    chrome.contextMenus.create({
      id: 'separator-1',
      type: 'separator',
      contexts: ['action']
    });
    
    chrome.contextMenus.create({
      id: 'detect-pinned',
      title: 'Show Pinned Tabs Count',
      contexts: ['action']
    });
    
    chrome.contextMenus.create({
      id: 'separator-2',
      type: 'separator',
      contexts: ['action']
    });
    
    chrome.contextMenus.create({
      id: 'open-settings',
      title: 'Settings',
      contexts: ['action']
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'move-past-pinned':
      await moveTabPastPinned(tab);
      break;
    case 'detect-pinned':
      await showPinnedTabsInfo();
      break;
    case 'open-settings':
      chrome.runtime.openOptionsPage();
      break;
  }
});

// Handle browser action clicks (when icon is clicked directly)
chrome.action.onClicked.addListener(async (tab) => {
  // Default action: move current tab past pinned tabs
  await moveTabPastPinned(tab);
});

/**
 * Detects pinned tabs in the current window
 * @returns {Promise<Array>} Array of pinned tabs
 */
async function getPinnedTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true, pinned: true });
  return tabs;
}

/**
 * Moves a tab to the first position after all pinned tabs
 * @param {Object} tab - The tab to move
 */
async function moveTabPastPinned(tab) {
  if (!tab) {
    // Get current active tab if none provided
    const [activeTab] = await chrome.tabs.query({ 
      active: true, 
      currentWindow: true 
    });
    tab = activeTab;
  }
  
  // Don't move if already pinned
  if (tab.pinned) {
    console.log('Tab is pinned, not moving');
    return;
  }
  
  const pinnedTabs = await getPinnedTabs();
  const targetIndex = pinnedTabs.length;
  
  // Only move if not already in the correct position
  if (tab.index !== targetIndex) {
    await chrome.tabs.move(tab.id, { index: targetIndex });
    console.log(`Moved tab ${tab.id} to index ${targetIndex} (past ${pinnedTabs.length} pinned tabs)`);
  } else {
    console.log('Tab is already in the first position after pinned tabs');
  }
}

/**
 * Shows information about pinned tabs via console and potentially notification
 */
async function showPinnedTabsInfo() {
  const pinnedTabs = await getPinnedTabs();
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  
  const message = `Pinned tabs: ${pinnedTabs.length} of ${allTabs.length} total tabs`;
  console.log(message);
  console.log('Pinned tab titles:', pinnedTabs.map(t => t.title));
  
  // Could add notification here if notification permission is added
  alert(message); // Simple alert for now
}

/**
 * Initialize default settings
 */
async function initializeDefaultSettings() {
  const settings = await chrome.storage.sync.get({
    autoMove: false,
    moveOnActivation: false,
    showNotifications: true
  });
  
  // Save defaults if they don't exist
  await chrome.storage.sync.set(settings);
}

/**
 * Get current settings
 * @returns {Promise<Object>} Current settings object
 */
async function getSettings() {
  return await chrome.storage.sync.get({
    autoMove: false,
    moveOnActivation: false,
    showNotifications: true
  });
}