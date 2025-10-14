/// <reference types="./ambient.d.ts" />

import { CronExpressionParser } from "cron-parser";
import { DEFAULTS } from './defaults.js';

if (typeof browser === "undefined") globalThis.browser = chrome;

const ACTIONABLE_ICON_PATHS = {
    16: 'icons/icon-on-16.png',
    32: 'icons/icon-on-32.png',
    48: 'icons/icon-on-48.png',
    128: 'icons/icon-on-128.png'
};

const NON_ACTIONABLE_ICON_PATHS = {
    16: 'icons/icon-off-16.png',
    32: 'icons/icon-off-32.png',
    48: 'icons/icon-off-48.png',
    128: 'icons/icon-off-128.png'
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
    const settings = await browser.storage.sync.get(DEFAULTS);
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

    browser.contextMenus.create({
        id: 'sponsor',
        title: '❤️ Sponsor me',
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
        case 'sponsor':
            browser.tabs.create({ url: 'https://github.com/sponsors/ewired' });
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
            markedAt: Date.now()
        };
        await browser.sessions.setTabValue(tab.id, 'actionable', actionableData);
        await updateIconForTab(tab.id, true);
        console.log(`Tab ${tab.id} marked as actionable`);
    }
}

/**
 * Update icon state for a specific tab
 * @param {number} tabId
 * @param {boolean | null} isActionable
 */
async function updateIconForTab(tabId, isActionable = null) {
    try {
        if (isActionable === null) {
            try {
                const actionableData = await browser.sessions.getTabValue(tabId, 'actionable');
                isActionable = !!actionableData;
            } catch (sessionError) {
                isActionable = false;
            }
        }

        const iconPaths = isActionable ? ACTIONABLE_ICON_PATHS : NON_ACTIONABLE_ICON_PATHS;

        await browser.action.setIcon({
            tabId: tabId,
            path: iconPaths
        });

        if (isActionable) {
            await browser.action.setTitle({ title: 'Actionable Tabs - This tab is actionable', tabId: tabId });
        } else {
            await browser.action.setTitle({ title: 'Actionable Tabs - Mark as actionable', tabId: tabId });
        }
    } catch (error) {
        console.log(`Could not update icon for tab ${tabId} (actionable: ${isActionable}):`, String(error));
    }
}

/**
 * Update icon state when tab is activated
 */
browser.tabs.onActivated.addListener(async (activeInfo) => {
    await updateIconForTab(activeInfo.tabId);
});

/**
 * Initialize the icon for the currently active tab
 * Called on extension startup to ensure correct icon state
 */
async function initializeIconForCurrentTab() {
    try {
        const [activeTab] = await browser.tabs.query({
            active: true,
            currentWindow: true
        });

        if (activeTab && activeTab.id) {
            await updateIconForTab(activeTab.id);
            console.log(`Initialized icon for active tab ${activeTab.id}`);
        } else {
            console.log('No active tab found during initialization');
        }
    } catch (error) {
        console.error('Failed to initialize icon for current tab:', error);
    }
}

/**
 * Update icon state when a new tab is created
 * Ensures new tabs show the correct icon state immediately
 */
browser.tabs.onCreated.addListener(async (tab) => {
    if (!tab.id) return;

    await updateIconForTab(tab.id);
    console.log(`Updated icon for newly created tab ${tab.id}`);
});

/**
 * Schedule the next automatic move based on cron settings
 */
async function scheduleNextMove() {
    const settings = await browser.storage.sync.get(DEFAULTS);
    const cronSchedule = /** @type {string} */ (settings.cronSchedule || DEFAULTS.cronSchedule);

    const delayMinutes = parseCronToNextDelay(cronSchedule);

    await browser.alarms.clear('moveActionableTabs');

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
    const DEFAULT_DELAY_MINUTES = 30;

    try {
        const options = {
            currentDate: new Date(),
            strict: false
        };

        const interval = CronExpressionParser.parse(cronSchedule, options);

        const nextDate = interval.next().toDate();
        const now = new Date();

        const delayMs = nextDate.getTime() - now.getTime();
        const delayMinutes = Math.ceil(delayMs / (1000 * 60));

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

        while (true) {
            const nextDate = interval.next().toDate();

            if (nextDate.getTime() > now.getTime()) {
                break;
            }

            missedCount++;

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
    const settings = await browser.storage.sync.get(DEFAULTS);
    const lastMoveTime = /** @type {number | null} */ (settings.lastMoveTime);

    if (!lastMoveTime) {
        console.log('No lastMoveTime found - skipping catch-up check');
        return;
    }

    const cronSchedule = /** @type {string} */ (settings.cronSchedule || DEFAULTS.cronSchedule);

    console.log(`Checking for missed moves since ${new Date(lastMoveTime).toISOString()}`);

    const missedMoves = calculateMissedMoves(cronSchedule, lastMoveTime);

    if (missedMoves > 0) {
        console.log(`Found ${missedMoves} missed scheduled move(s) - executing catch-up`);

        await moveActionableTabsToTop();

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
        await scheduleNextMove();
    }
});

/**
 * Get actionable tabs sorted according to queue mode
 * @param {string} queueMode - The queue mode setting
 * @returns {Promise<Array<{tabId: number, data: {markedAt: number}, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>>}
 */
async function getActionableTabsSorted(queueMode) {
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const validTabs = /** @type {(import('webextension-polyfill').Tabs.Tab & {id: number})[]} */ (allTabs.filter(t => t.id != null));

    const actionableTabsData = [];
    for (const tab of validTabs) {
        const actionableData = /** @type {{ markedAt: number } | undefined} */ (await browser.sessions.getTabValue(tab.id, 'actionable'));
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
    const settings = await browser.storage.sync.get(DEFAULTS);
    const queueMode = /** @type {string} */ (settings.queueMode || DEFAULTS.queueMode);

    const moveCount = isManual ? 1 : /** @type {number} */ (settings.moveCount || DEFAULTS.moveCount);

    const actionableTabsData = await getActionableTabsSorted(queueMode);

    if (actionableTabsData.length === 0) {
        console.log('No actionable tabs to move');

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

    /** @type {Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}, oldIndex: number, newIndex: number, didMove: boolean}>} */
    const moveResults = [];

    for (let i = 0; i < tabsToMove.length; i++) {
        const { tabId, data, tab } = tabsToMove[i];
        const oldIndex = tab.index;
        const desiredIndex = targetIndex + i;

        try {
            const movedTab = await browser.tabs.move(tabId, { index: desiredIndex });
            const newIndex = Array.isArray(movedTab) ? movedTab[0].index : movedTab.index;

            const didMove = oldIndex !== newIndex;
            moveResults.push({ tabId, tab, oldIndex, newIndex, didMove });

            if (didMove) {
                console.log(`Moved actionable tab ${tabId} (${tab.title}) from index ${oldIndex} to ${newIndex}`);
            } else {
                console.log(`Tab ${tabId} (${tab.title}) already at correct index ${newIndex}`);
            }
        } catch (error) {
            console.error(`Error moving tab ${tabId}:`, error);
            moveResults.push({ tabId, tab, oldIndex, newIndex: oldIndex, didMove: false });
        }
    }

    const anyTabMoved = moveResults.some(result => result.didMove);

    if (!isManual) {
        await browser.storage.sync.set({ lastMoveTime: Date.now() });
    }

    if (isManual) {
        if (anyTabMoved) {
            const firstResult = moveResults[0];
            const message = moveResults.length === 1
                ? `Pulled "${firstResult.tab.title}" to top`
                : `Moved ${moveResults.length} actionable tab(s) to top`;

            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: message
            });
        } else {
            const firstResult = moveResults[0];
            browser.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon-on-48.png',
                title: 'Actionable Tabs',
                message: `"${firstResult.tab.title}" is already at the top`
            });
        }
    } else {
        const shouldShowNotification = anyTabMoved && (settings.showNotifications !== false);

        if (shouldShowNotification) {
            const { tab } = moveResults[0];
            const message = moveResults.length === 1
                ? `Pulled "${tab.title}" to top`
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

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        if (typeof message !== "object" || message == null || !("action" in message)) {
            return { success: false }
        } else if (message.action === 'clearAllActionableTabs') {
            try {
                const clearedCount = await clearAllActionableTabs()
                return { success: true, clearedCount };
            }
            catch (error) {
                console.error('Error clearing all actionable tabs:', error);
                return { success: false }
            }
        }
    })().then((r) => sendResponse(r));
    return true;
});

/**
 * Clear all actionable tabs by removing the actionable session data
 * @returns {Promise<number>} Number of tabs that were cleared
 */
async function clearAllActionableTabs() {
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const validTabs = allTabs.filter(t => t.id != null);

    let clearedCount = 0;

    for (const tab of validTabs) {
        const tabId = /** @type {number} */ (tab.id);
        try {
            const actionableData = await browser.sessions.getTabValue(tabId, 'actionable');
            if (actionableData) {
                await browser.sessions.removeTabValue(tabId, 'actionable');
                await updateIconForTab(tabId, false);
                clearedCount++;
                console.log(`Cleared actionable state for tab ${tabId} (${tab.title})`);
            }
        } catch (error) {
            console.error(`Error clearing actionable state for tab ${tabId}:`, error);
        }
    }

    if (clearedCount > 0) {
        browser.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon-off-48.png',
            title: 'Actionable Tabs',
            message: `Cleared ${clearedCount} actionable tab(s)`
        });
    }

    return clearedCount;
}
