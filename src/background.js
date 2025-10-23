/// <reference types="./ambient.d.ts" />

import { CronExpressionParser } from "cron-parser";
import { DEFAULTS } from "./defaults.js";
import { clearAllActionableTabs, moveActionableTabsToTop } from "./tab.js";

if (typeof browser === "undefined") globalThis.browser = chrome;

const ACTIONABLE_ICON_PATHS = {
	16: "icons/icon-on-16.png",
	32: "icons/icon-on-32.png",
	48: "icons/icon-on-48.png",
	128: "icons/icon-on-128.png",
};

const NON_ACTIONABLE_ICON_PATHS = {
	16: "icons/icon-off-16.png",
	32: "icons/icon-off-32.png",
	48: "icons/icon-off-48.png",
	128: "icons/icon-off-128.png",
};
browser.runtime.onInstalled.addListener(async () => {
	console.log("Actionable Tabs extension installed");

	await initializeDefaultSettings();
	createContextMenus();
	await scheduleNextMove();
	await initializeIconsForAllTabs();
});

browser.runtime.onStartup.addListener(async () => {
	await checkForMissedMovesAndCatchUp();
	await scheduleNextMove();
	await initializeIconsForAllTabs();
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
		id: "pull-actionable-tab-left",
		title: "Pull Actionable Tab to Top/Left",
		contexts: ["action"],
	});

	browser.contextMenus.create({
		id: "pull-actionable-tab-right",
		title: "Pull Actionable Tab to Bottom/Right",
		contexts: ["action"],
	});

	browser.contextMenus.create({
		id: "separator-1",
		type: "separator",
		contexts: ["action"],
	});

	browser.contextMenus.create({
		id: "open-settings",
		title: "Settings",
		contexts: ["action"],
	});

	browser.contextMenus.create({
		id: "sponsor",
		title: "❤️ Sponsor me",
		contexts: ["action"],
	});
}

/**
 * Handle context menu clicks
 */
browser.contextMenus.onClicked.addListener(async (info, _tab) => {
	switch (info.menuItemId) {
		case "pull-actionable-tab-left": {
			await moveActionableTabsToTop("left");
			break;
		}
		case "pull-actionable-tab-right": {
			await moveActionableTabsToTop("right");
			break;
		}
		case "open-settings":
			browser.runtime.openOptionsPage();
			break;
		case "sponsor":
			browser.tabs.create({ url: "https://github.com/sponsors/ewired" });
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

	const isCurrentlyActionable = await browser.sessions.getTabValue(
		tab.id,
		"actionable",
	);

	if (isCurrentlyActionable) {
		await browser.sessions.removeTabValue(tab.id, "actionable");
		await updateIconForTab(tab.id, false);
		console.log(`Tab ${tab.id} unmarked as actionable`);
	} else {
		const actionableData = {
			markedAt: Date.now(),
		};
		await browser.sessions.setTabValue(tab.id, "actionable", actionableData);
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
				const actionableData = await browser.sessions.getTabValue(
					tabId,
					"actionable",
				);
				isActionable = !!actionableData;
			} catch (_sessionError) {
				isActionable = false;
			}
		}

		const iconPaths = isActionable
			? ACTIONABLE_ICON_PATHS
			: NON_ACTIONABLE_ICON_PATHS;

		await browser.action.setIcon({
			tabId: tabId,
			path: iconPaths,
		});

		if (isActionable) {
			await browser.action.setTitle({
				title: "Actionable Tabs - This tab is actionable",
				tabId: tabId,
			});
		} else {
			await browser.action.setTitle({
				title: "Actionable Tabs - Mark as actionable",
				tabId: tabId,
			});
		}
	} catch (error) {
		console.log(
			`Could not update icon for tab ${tabId} (actionable: ${isActionable}):`,
			String(error),
		);
	}
}

/**
 * Update icon state when tab is activated
 */
browser.tabs.onActivated.addListener(async (activeInfo) => {
	await updateIconForTab(activeInfo.tabId);
});

/**
 * Update icon state for all currently open tabs
 * Ensures all tabs show the correct actionable/non-actionable icon state
 * Called on extension startup to pre-set correct icons for existing tabs
 */
async function initializeIconsForAllTabs() {
	try {
		const allTabs = await browser.tabs.query({});
		const validTabs = allTabs.filter((t) => t.id != null);

		console.log(`Initializing icons for ${validTabs.length} tabs`);

		for (const tab of validTabs) {
			const tabId = /** @type {number} */ (tab.id);
			await updateIconForTab(tabId);
		}

		console.log("Completed icon initialization for all tabs");
	} catch (error) {
		console.error("Failed to initialize icons for all tabs:", error);
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
 * Update icon state when a tab is updated (including reloads)
 * Ensures the correct icon state is maintained after tab reloads
 */
browser.tabs.onUpdated.addListener(async (tabId) => {
	await updateIconForTab(tabId);
});

/**
 * Schedule the next automatic move based on cron settings
 */
async function scheduleNextMove() {
	const settings = await browser.storage.sync.get(DEFAULTS);
	const cronSchedule = /** @type {string} */ (
		settings.cronSchedule || DEFAULTS.cronSchedule
	);

	const delayMinutes = parseCronToNextDelay(cronSchedule);

	// Ensure minimum delay to prevent scheduling issues
	nextDelayMinutes = Math.max(1, nextDelayMinutes);

	await browser.alarms.clear("moveActionableTabs");

	await browser.alarms.create("moveActionableTabs", {
		delayInMinutes: delayMinutes,
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
			strict: false,
		};

		const interval = CronExpressionParser.parse(cronSchedule, options);

		const nextDate = interval.next().toDate();
		const now = new Date();

		const delayMs = nextDate.getTime() - now.getTime();
		const delayMinutes = Math.ceil(delayMs / (1000 * 60));

		const finalDelay = Math.max(1, delayMinutes);

		console.log(
			`Cron: "${cronSchedule}" - Next execution at ${nextDate.toISOString()} (in ${finalDelay} minutes)`,
		);

		return finalDelay;
	} catch (error) {
		console.error(`Failed to parse cron expression "${cronSchedule}":`, error);
		console.log(
			`Falling back to default delay of ${DEFAULT_DELAY_MINUTES} minutes`,
		);
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
			strict: false,
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
				console.warn(
					"Reached maximum iteration limit while calculating missed moves",
				);
				break;
			}
		}

		return missedCount;
	} catch (error) {
		console.error(
			`Failed to calculate missed moves for cron "${cronSchedule}":`,
			error,
		);
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
		console.log("No lastMoveTime found - skipping catch-up check");
		return;
	}

	const cronSchedule = /** @type {string} */ (
		settings.cronSchedule || DEFAULTS.cronSchedule
	);

	console.log(
		`Checking for missed moves since ${new Date(lastMoveTime).toISOString()}`,
	);

	const missedMoves = calculateMissedMoves(cronSchedule, lastMoveTime);

	if (missedMoves > 0) {
		console.log(
			`Found ${missedMoves} missed scheduled move(s) - executing catch-up`,
		);

		await moveActionableTabsToTop(undefined);

		await browser.storage.sync.set({ lastMoveTime: Date.now() });

		console.log(
			`Catch-up complete - brought ${missedMoves} missed move(s) current`,
		);
	} else {
		console.log("No missed moves detected");
	}
}

/**
 * Listen for settings changes and reschedule
 */
browser.storage.onChanged.addListener(async (changes, areaName) => {
	if (areaName === "sync" && changes.cronSchedule) {
		await scheduleNextMove();
	}
});

/**
 * Handle alarm events - move actionable tabs and reschedule next execution
 */
browser.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "moveActionableTabs") {
		await moveActionableTabsToTop(undefined);
		await scheduleNextMove();
	}
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	(async () => {
		if (
			typeof message !== "object" ||
			message == null ||
			!("action" in message)
		) {
			return { success: false };
		} else if (message.action === "clearAllActionableTabs") {
			try {
				const clearedCount = await clearAllActionableTabs();
				await initializeIconsForAllTabs();
				return { success: true, clearedCount };
			} catch (error) {
				console.error("Error clearing all actionable tabs:", error);
				return { success: false };
			}
		}
	})().then((r) => sendResponse(r));
	return true;
});
