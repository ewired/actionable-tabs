# Actionable Tabs

A browser extension for managing and organizing tabs with a focus on handling pinned tabs.

## Features

- **Browser Action**: Click the extension icon to move the current tab past all pinned tabs
- **Context Menu**: Right-click the extension icon for additional actions:
  - Move current tab past pinned tabs
  - Show count of pinned tabs
  - Open settings page
- **Settings Page**: Configure extension behavior
  - Auto-move new tabs past pinned tabs (planned)
  - Move tabs when activated (planned)
  - Toggle notifications
- **Pinned Tab Detection**: Automatically detects and handles pinned tabs
- **Tab Movement**: Moves tabs to the first position after all pinned tabs

## Installation

### Firefox
1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on"
4. Navigate to the extension directory and select `manifest.json`

### Chrome/Edge/Brave
1. Open the browser and navigate to the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the extension directory

## Usage

### Quick Actions
- **Click the extension icon**: Moves the current tab to the first position after pinned tabs
- **Right-click the extension icon**: Access context menu with additional options

### Settings
- Click "Settings" in the context menu to configure the extension
- Settings are automatically saved and persist across browser restarts

## Development

### Project Structure
```
actionable-tabs/
├── manifest.json          # Extension manifest
├── background.js          # Background service worker
├── settings/
│   ├── settings.html      # Settings page UI
│   ├── settings.css       # Settings page styles
│   └── settings.js        # Settings page logic
├── icons/                 # Extension icons
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

### Key APIs Used
- `chrome.tabs` - Tab management and queries
- `chrome.contextMenus` - Context menu creation
- `chrome.storage.sync` - Persistent settings storage
- `chrome.action` - Browser action handling

## Permissions

- `tabs`: Access and manipulate browser tabs
- `contextMenus`: Create context menu items
- `storage`: Store and retrieve user settings

## Future Enhancements

- Automatic tab movement based on user settings
- Keyboard shortcuts for common actions
- Tab grouping integration
- Custom rules for tab positioning
- Export/import settings

## License

[To be determined]

## Contributing

[To be determined]