# Actionable Tabs

Browser extension that automatically pulls marked tabs to the top of your tab bar on a schedule.

## Features

- **Mark tabs as actionable**: Click the extension icon to toggle a tab's actionable state
- **Automatic scheduling**: Tabs are pulled to the top based on a cron schedule (default: every 30 minutes)
- **Queue modes**: Choose which tabs get pulled first (oldest-first, newest-first, leftmost-first, rightmost-first)
- **Manual pull**: Right-click the extension icon to immediately pull an actionable tab to the top
- **Visual feedback**: Actionable tabs show a green checkmark badge

## Installation

### Firefox
1. Navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json`

### Chrome/Edge/Brave
1. Navigate to extensions page (`chrome://extensions`, `edge://extensions`, or `brave://extensions`)
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension directory

## Usage

- **Click icon**: Toggle current tab as actionable
- **Right-click icon**: Pull actionable tab to top or open settings
- **Settings**: Configure cron schedule, queue mode, move count, and notifications

## Settings

- **Cron Schedule**: When to automatically pull tabs (e.g., `*/30 * * * *` = every 30 minutes)
- **Queue Mode**: Which actionable tabs to prioritize
- **Move Count**: Number of actionable tabs to move per scheduled execution (1-10)
- **Notifications**: Toggle notifications when tabs are moved

## Permissions

- `tabs`: Tab management
- `contextMenus`: Right-click menu
- `storage`: Settings persistence
- `alarms`: Scheduled execution
- `notifications`: Move notifications
- `sessions`: Tab state storage