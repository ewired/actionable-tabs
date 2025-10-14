/// <reference types="./ambient.d.ts" />

import { CronExpressionParser } from "cron-parser";

if (typeof browser === "undefined") globalThis.browser = chrome;

const DEFAULT_SETTINGS = {
    cronSchedule: '*/30 * * * *', // every 30 minutes
    queueMode: 'leftmost-first', // 'oldest-first', 'newest-first', 'leftmost-first', 'rightmost-first'
    lastMoveTime: null,
    moveCount: 1 // how many actionable tabs to move per cron execution
};

browser.runtime.onInstalled.addListener(async () => {
    console.log('Actionable Tabs extension installed');

    await initializeDefaultSettings();
    createContextMenus();
    await scheduleNextMove();
    await initializeIconForCurrentTab();
});

browser.runtime.onStartup.addListener(async () => {
    await checkForMissedMovesAndCatchUp();
    await scheduleNextMove();
    await initializeIconForCurrentTab();
});

/**
 * Initialize default settings
 */
async function initializeDefaultSettings() {
    const settings = await browser.storage.sync.get(DEFAULT_SETTINGS);
    await browser.storage.sync.set(settings);
}

/**
 * Create context menu items
 */
async function createContextMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
        id: 'pull-actionable-tab',
        title: 'Pull Actionable Tab to Top',
        contexts: ['action']
    });

    browser.contextMenus.create({
        id: 'separator-1',
        type: 'separator',
        contexts: ['action']
    });

    browser.contextMenus.create({
        id: 'open-settings',
        title: 'Settings',
        contexts: ['action']
    });
}

/**
 * Handle context menu clicks
 */
browser.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
        case 'pull-actionable-tab':
            await moveActionableTabsToTop(true);
            break;
        case 'open-settings':
            browser.runtime.openOptionsPage();
            break;
    }
});

/**
 * Handle browser action clicks - toggle actionable state
 */
browser.action.onClicked.addListener(async (tab) => {
    await toggleActionableState(tab);
});

/**
 * Toggle whether the current tab is actionable
 * @param {import('webextension-polyfill').Tabs.Tab} tab
 */
async function toggleActionableState(tab) {
    if (!tab.id) return;

    const isCurrentlyActionable = await browser.sessions.getTabValue(tab.id, 'actionable');

    if (isCurrentlyActionable) {
        await browser.sessions.removeTabValue(tab.id, 'actionable');
        await updateIconForTab(tab.id, false);
        console.log(`Tab ${tab.id} unmarked as actionable`);
    } else {
        const actionableData = {
            markedAt: Date.now(),
            url: tab.url,
            title: tab.title
        };
        await browser.sessions.setTabValue(tab.id, 'actionable', actionableData);
        await updateIconForTab(tab.id, true);
        console.log(`Tab ${tab.id} marked as actionable`);
    }
}

/**
 * Update icon state for a specific tab
 * @param {number} tabId
 * @param {boolean} isActionable
 */
async function updateIconForTab(tabId, isActionable) {
    try {
        // Define icon paths based on actionable state
        const iconPaths = isActionable ? {
            16: 'icons/icon-on-32.png',  // Use 32px for 16px (better quality)
            32: 'icons/icon-on-32.png',
            48: 'icons/icon-on-48.png',
            128: 'icons/icon-on-128.png'
        } : {
            16: 'icons/icon-off-32.png',  // Use 32px for 16px (better quality)
            32: 'icons/icon-off-32.png',
            48: 'icons/icon-off-48.png',
            128: 'icons/icon-off-128.png'
        };

        // Set the icon for the specific tab
        await browser.action.setIcon({
            tabId: tabId,
            path: iconPaths
        });

        // Update title
        if (isActionable) {
            await browser.action.setTitle({ title: 'Actionable Tabs - This tab is actionable', tabId: tabId });
        } else {
            await browser.action.setTitle({ title: 'Actionable Tabs - Mark as actionable', tabId: tabId });
        }
    } catch (error) {
        console.log(`Could not update icon for tab ${tabId}:`, error);
    }
}

/**
 * Update icon state when tab is activated
 */
browser.tabs.onActivated.addListener(async (activeInfo) => {
    const isActionable = await browser.sessions.getTabValue(activeInfo.tabId, 'actionable');
    await updateIconForTab(activeInfo.tabId, !!isActionable);
});

/**
 * Update stored tab info when URL changes
 */
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const actionableData = /** @type {{ markedAt: number, url: string, title: string } | undefined} */ (await browser.sessions.getTabValue(tabId, 'actionable'));

    if (actionableData) {
        if (changeInfo.url || changeInfo.title) {
            const updated = {
                ...actionableData,
                url: tab.url || actionableData.url,
                title: tab.title || actionableData.title
            };
            await browser.sessions.setTabValue(tabId, 'actionable', updated);
        }

        await updateIconForTab(tabId, true);
    }
});

/**
 * Initialize the icon for the currently active tab
 * Called on extension startup to ensure correct icon state
 */
async function initializeIconForCurrentTab() {
    try {
        // Get the current active tab in the current window
        const [activeTab] = await browser.tabs.query({
            active: true,
            currentWindow: true
        });

        if (activeTab && activeTab.id) {
            // Check if the active tab is actionable and update icon accordingly
            const isActionable = await browser.sessions.getTabValue(activeTab.id, 'actionable');
            await updateIconForTab(activeTab.id, !!isActionable);
            console.log(`Initialized icon for active tab ${activeTab.id}: ${!!isActionable ? 'actionable' : 'not actionable'}`);
        }
    } catch (error) {
        console.error('Failed to initialize icon for current tab:', error);
    }
}

/**
 * Schedule the next automatic move based on cron settings
 */
async function scheduleNextMove() {
    const settings = await browser.storage.sync.get(DEFAULT_SETTINGS);
    const cronSchedule = /** @type {string} */ (settings.cronSchedule || DEFAULT_SETTINGS.cronSchedule);

    const delayMinutes = parseCronToNextDelay(cronSchedule);

    // Clear any existing alarm first
    await browser.alarms.clear('moveActionableTabs');

    // Create one-time alarm (not periodic) - we'll reschedule after execution
    await browser.alarms.create('moveActionableTabs', {
        delayInMinutes: delayMinutes
    });

    console.log(`Scheduled next move in ${delayMinutes} minutes`);
}

/**
 * Parse cron expression to get delay in minutes until next execution
 * Uses cron-parser library to handle full cron syntax
 * @param {string} cronSchedule - Cron expression (5 or 6 fields supported)
 * @returns {number} Delay in minutes until next cron execution (minimum 1 minute)
 */
function parseCronToNextDelay(cronSchedule) {
    // Default fallback to 30 minutes if parsing fails
    const DEFAULT_DELAY_MINUTES = 30;

    try {
        // Parse the cron expression with current time as reference
        const options = {
            currentDate: new Date(),
            // Don't use strict mode to allow flexibility with 5-field expressions
            strict: false
        };

        const interval = CronExpressionParser.parse(cronSchedule, options);

        // Get the next occurrence
        const nextDate = interval.next().toDate();
        const now = new Date();

        // Calculate delay in milliseconds, then convert to minutes
        const delayMs = nextDate.getTime() - now.getTime();
        const delayMinutes = Math.ceil(delayMs / (1000 * 60));

        // Ensure minimum delay of 1 minute
        const finalDelay = Math.max(1, delayMinutes);

        console.log(`Cron: "${cronSchedule}" - Next execution at ${nextDate.toISOString()} (in ${finalDelay} minutes)`);

        return finalDelay;
    } catch (error) {
        console.error(`Failed to parse cron expression "${cronSchedule}":`, error);
        console.log(`Falling back to default delay of ${DEFAULT_DELAY_MINUTES} minutes`);
        return DEFAULT_DELAY_MINUTES;
    }
}

/**
 * Calculate how many scheduled moves were missed since lastMoveTime
 * @param {string} cronSchedule - Cron expression
 * @param {number} lastMoveTime - Timestamp of last move (milliseconds since epoch)
 * @returns {number} Number of missed moves (0 if none or on error)
 */
function calculateMissedMoves(cronSchedule, lastMoveTime) {
    try {
        const options = {
            currentDate: new Date(lastMoveTime),
            strict: false
        };

        const interval = CronExpressionParser.parse(cronSchedule, options);
        const now = new Date();
        let missedCount = 0;

        // Iterate through scheduled times from lastMoveTime until now
        while (true) {
            const nextDate = interval.next().toDate();

            // If next scheduled time is in the future, we're done counting
            if (nextDate.getTime() > now.getTime()) {
                break;
            }

            missedCount++;

            // Safety check: prevent infinite loops (max 10000 iterations)
            // At 1-minute intervals, this covers ~7 days
            if (missedCount > 10000) {
                console.warn('Reached maximum iteration limit while calculating missed moves');
                break;
            }
        }

        return missedCount;
    } catch (error) {
        console.error(`Failed to calculate missed moves for cron "${cronSchedule}":`, error);
        return 0;
    }
}

/**
 * Check for missed scheduled moves since last browser session and catch up if needed
 * Called on browser startup to ensure idempotency across restarts
 */
async function checkForMissedMovesAndCatchUp() {
    const settings = await browser.storage.sync.get(DEFAULT_SETTINGS);
    const lastMoveTime = /** @type {number | null} */ (settings.lastMoveTime);

    // If lastMoveTime is not set, this is likely first run or no moves have occurred yet
    if (!lastMoveTime) {
        console.log('No lastMoveTime found - skipping catch-up check');
        return;
    }

    const cronSchedule = /** @type {string} */ (settings.cronSchedule || DEFAULT_SETTINGS.cronSchedule);

    console.log(`Checking for missed moves since ${new Date(lastMoveTime).toISOString()}`);

    const missedMoves = calculateMissedMoves(cronSchedule, lastMoveTime);

    if (missedMoves > 0) {
        console.log(`Found ${missedMoves} missed scheduled move(s) - executing catch-up`);

        // Execute a single move to catch up
        await moveActionableTabsToTop();

        // Update lastMoveTime to now after catching up
        await browser.storage.sync.set({ lastMoveTime: Date.now() });

        console.log(`Catch-up complete - brought ${missedMoves} missed move(s) current`);
    } else {
        console.log('No missed moves detected');
    }
}

/**
 * Listen for settings changes and reschedule
 */
browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'sync' && changes.cronSchedule) {
        await scheduleNextMove();
    }
});

/**
 * Handle alarm events - move actionable tabs and reschedule next execution
 */
browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'moveActionableTabs') {
        await moveActionableTabsToTop();
        // Reschedule the next execution based on current cron expression
        await scheduleNextMove();
    }
});

/**
 * Get actionable tabs sorted according to queue mode
 * @param {string} queueMode - The queue mode setting
 * @returns {Promise<Array<{tabId: number, data: {markedAt: number, url: string, title: string}, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>>}
 */
async function getActionableTabsSorted(queueMode) {
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const validTabs = /** @type {(import('webextension-polyfill').Tabs.Tab & {id: number})[]} */ (allTabs.filter(t => t.id != null));

    const actionableTabsData = [];
    for (const tab of validTabs) {
        const actionableData = /** @type {{ markedAt: number, url: string, title: string } | undefined} */ (await browser.sessions.getTabValue(tab.id, 'actionable'));
        if (actionableData) {
            actionableTabsData.push({
                tabId: tab.id,
                data: actionableData,
                tab: tab
            });
        }
    }

    switch (queueMode) {
        case 'oldest-first':
            actionableTabsData.sort((a, b) => a.data.markedAt - b.data.markedAt);
            break;
        case 'newest-first':
            actionableTabsData.sort((a, b) => b.data.markedAt - a.data.markedAt);
            break;
        case 'leftmost-first':
            actionableTabsData.sort((a, b) => a.tab.index - b.tab.index);
            break;
        case 'rightmost-first':
            actionableTabsData.sort((a, b) => b.tab.index - a.tab.index);
            break;
    }

    return actionableTabsData;
}

/**
 * Get the target index for moving actionable tabs (after pinned tabs)
 * @returns {Promise<number>}
 */
async function getTargetIndexForActionableTabs() {
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const validTabs = /** @type {(import('webextension-polyfill').Tabs.Tab & {id: number})[]} */ (allTabs.filter(t => t.id != null));
    const pinnedTabs = validTabs.filter(t => t.pinned);
    return pinnedTabs.length;
}

/**
 * Move actionable tabs to top based on settings
 * @param {boolean} isManual - If true, override moveCount to 1 and always show notifications
 */
async function moveActionableTabsToTop(isManual = false) {
    const settings = await browser.storage.sync.get(DEFAULT_SETTINGS);
    const queueMode = /** @type {string} */ (settings.queueMode || DEFAULT_SETTINGS.queueMode);

    // Override moveCount to 1 when manually invoked, otherwise use configured setting
    const moveCount = isManual ? 1 : /** @type {number} */ (settings.moveCount || DEFAULT_SETTINGS.moveCount);

    const actionableTabsData = await getActionableTabsSorted(queueMode);

    if (actionableTabsData.length === 0) {
        console.log('No actionable tabs to move');

        // Show notification when manually invoked
        if (isManual) {
            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: 'No actionable tabs to pull'
            });
        }
        return;
    }

    const targetIndex = await getTargetIndexForActionableTabs();
    const tabsToMove = actionableTabsData.slice(0, moveCount);

    // Track which tabs actually moved by comparing old vs new indices
    const moveResults = [];

    for (let i = 0; i < tabsToMove.length; i++) {
        const { tabId, data, tab } = tabsToMove[i];
        const oldIndex = tab.index;
        const desiredIndex = targetIndex + i;

        try {
            // browser.tabs.move returns the moved tab(s) with updated index
            const movedTab = await browser.tabs.move(tabId, { index: desiredIndex });
            const newIndex = Array.isArray(movedTab) ? movedTab[0].index : movedTab.index;

            const didMove = oldIndex !== newIndex;
            moveResults.push({ tabId, data, oldIndex, newIndex, didMove });

            if (didMove) {
                console.log(`Moved actionable tab ${tabId} (${data.title}) from index ${oldIndex} to ${newIndex}`);
            } else {
                console.log(`Tab ${tabId} (${data.title}) already at correct index ${newIndex}`);
            }
        } catch (error) {
            console.error(`Error moving tab ${tabId}:`, error);
            moveResults.push({ tabId, data, oldIndex, newIndex: oldIndex, didMove: false });
        }
    }

    // Check if any tabs actually moved
    const anyTabMoved = moveResults.some(result => result.didMove);

    // Always update lastMoveTime for automatic invocations
    if (!isManual) {
        await browser.storage.sync.set({ lastMoveTime: Date.now() });
    }

    // Determine notification behavior
    if (isManual) {
        // Manual invocation: always show notification with appropriate message
        if (anyTabMoved) {
            const { data } = moveResults[0];
            const message = moveResults.length === 1
                ? `Pulled "${data.title}" to top`
                : `Moved ${moveResults.length} actionable tab(s) to top`;

            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: message
            });
        } else {
            // Tab was already in position
            const { data } = moveResults[0];
            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: `"${data.title}" is already at the top`
            });
        }
    } else {
        // Automatic invocation: only show notification if tabs actually moved
        const shouldShowNotification = anyTabMoved && (settings.showNotifications !== false);

        if (shouldShowNotification) {
            const { data } = moveResults[0];
            const message = moveResults.length === 1
                ? `Pulled "${data.title}" to top`
                : `Moved ${moveResults.length} actionable tab(s) to top`;

            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: message
            });
        }
    }
}
