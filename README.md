# Actionable Tabs

Mark tabs as actionable and automatically bring them to the top on a schedule. Perfect for managing tasks, reminders, and important tabs if you view your browser tabs as a queue.

Actionable Tabs revolves around two simple actions:

1. **Mark tabs as actionable**: Click the extension icon on any tab to mark it as actionable (as opposed to consumable, readable, etc.)
2. **Schedule automatic movement**: Configure rules with cron schedules to move the actionable tabs. For example, move an actionable tab to the top before you begin working.

## Features

- **Multiple scheduling rules**: Create rules with cron schedules or manual-only execution
- **Flexible tab management**: Choose queue modes (oldest/newest/leftmost/rightmost) and move direction (left/right)
- **Manual control**: Right-click to immediately pull actionable tabs based on rules
- **Visual feedback**: Actionable tabs show a green checkmark badge
- **Rule management**: Add, remove, and reorder rules with status dashboard
- **Smart notifications**: Aggregated summaries when multiple rules run

## Usage

- **Click icon**: Toggle current tab as actionable
- **Right-click icon**: Pull actionable tab or open settings
- **Settings**: Configure rules with schedules, queue modes, move counts, directions, and notifications

## Settings

Each rule supports:
- **Cron Schedule**: When to pull tabs (e.g., `*/30 * * * *` = every 30 minutes, or empty for manual-only)
- **Queue Mode**: Which tabs to prioritize (oldest, newest, leftmost, rightmost)
- **Move Count**: Tabs to move per execution (1-10)
- **Move Direction**: Left (after pinned tabs) or right (end of tab strip)
- **Notifications**: Toggle notifications for this rule

Manage rules through add, remove, and reorder actions. View status including last move time and next execution. Rule order is preserved during execution of rules with the same schedule.

## Suggestions

- **Your browser is a queue**: Every tab is either something to do or information to consume. This extension can help you manage the balance of time between creation/work and consumption/reading.
- **Inbox zero for tabs**:  Tabs are closed when they're done, or pushed to the back of the queue when they will have to be revisited. Use links to headers on long reads to break them up into sections.
- **[Notepad Tab](https://notepadtab.com)** - A simple notepad that lives in a browser tab, persisted to the URL hash. Use these as actionable tabs for physical or browser-external tasks, or sketch ideas for projects yet to start.
