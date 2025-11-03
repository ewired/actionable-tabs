/// <reference types="./ambient.d.ts" />

import { CronExpressionParser } from "cron-parser";
import { getMostRecentLastMoveTime, getSettings } from "./storage.js";
import {
	clearAllActionableTabs,
	getActionableTabsSorted,
	getContextMenuTitle,
	getTargetIndexForActionableTabs,
	moveActionableTabManually,
	moveActionableTabs,
} from "./tab.js";

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

	await getSettings();
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
 * Execute all rules in order
 */
async function executeAllRules() {
	const settings = await getSettings();
	let rules = settings.rules;

	for (const rule of rules) {
		console.log(`Executing rule ${rule.id} (${rule.cronSchedule})`);
		try {
			await moveActionableTabsForRule(rule);
			// Update the lastMoveTime for this specific rule
			rules = rules.map((r) =>
				r.id === rule.id ? { ...r, lastMoveTime: Date.now() } : r,
			);
		} catch (error) {
			console.error(`Error executing rule ${rule.id}:`, error);
			// Continue with next rule even if this one failed
		}
	}

	// Save all updated rules at once
	await browser.storage.sync.set({ rules: structuredClone(rules) });

	// Reschedule the next move to ensure the alarm schedule is up-to-date
	await scheduleNextMove();
}

/**
 * Move actionable tabs for a specific rule
 * @param {{id: string, cronSchedule: string, queueMode: string, moveCount: number, moveDirection: string, showNotifications: boolean, lastMoveTime: number | null}} rule - The rule to execute
 */
async function moveActionableTabsForRule(rule) {
	const actionableTabsData = await getActionableTabsSorted(rule.queueMode);

	if (actionableTabsData.length === 0) {
		console.log(`No actionable tabs to move for rule ${rule.id}`);
		return;
	}

	const targetIndex = await getTargetIndexForActionableTabs(rule.moveDirection);
	const tabsToMove = actionableTabsData.slice(0, rule.moveCount);

	// Use shared function to move tabs
	const moveResults = await moveActionableTabs({
		actionableTabsData: tabsToMove,
		targetIndex: targetIndex,
	});

	// Handle rule-specific notifications
	const anyTabMoved = moveResults.some((result) => result.didMove);

	if (anyTabMoved && rule.showNotifications) {
		const { tab } = moveResults[0];
		const directionText =
			rule.moveDirection === "right" ? "bottom/right" : "top/left";
		const message =
			moveResults.length === 1
				? `Pulled "${tab.title}" to ${directionText}`
				: `Moved ${moveResults.length} actionable tab(s) to ${directionText}`;

		browser.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-on-48.png",
			title: "Actionable Tabs",
			message: message,
		});
	}
}

/**
 * Create context menu items dynamically based on rules
 */
async function createContextMenus() {
	await browser.contextMenus.removeAll();
	const settings = await getSettings();
	const rules = settings.rules;

	// Create deduplicated menu items based on unique action combinations
	const uniqueActions = new Map();

	for (const rule of rules) {
		const actionKey = `${rule.queueMode}_${rule.moveDirection}`;
		if (!uniqueActions.has(actionKey)) {
			uniqueActions.set(actionKey, {
				queueMode: rule.queueMode,
				moveDirection: rule.moveDirection,
				ruleIds: [rule.id],
			});
		} else {
			uniqueActions.get(actionKey).ruleIds.push(rule.id);
		}
	}

	// Create menu items for each unique action
	let menuItemIndex = 0;
	for (const [actionKey, action] of uniqueActions) {
		const { queueMode, moveDirection } = action;
		const title = getContextMenuTitle(queueMode, moveDirection);

		browser.contextMenus.create({
			id: `pull-actionable-tab_${actionKey}`,
			title: title,
			contexts: ["action"],
		});
		menuItemIndex++;
	}

	if (menuItemIndex > 0) {
		browser.contextMenus.create({
			id: "separator-1",
			type: "separator",
			contexts: ["action"],
		});
	}

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
	const menuItemId = info.menuItemId;

	if (
		typeof menuItemId === "string" &&
		menuItemId.startsWith("pull-actionable-tab_")
	) {
		// Extract queueMode and moveDirection from the menu item ID
		const actionKey = menuItemId.replace("pull-actionable-tab_", "");
		const [queueMode, moveDirection] = actionKey.split("_");

		try {
			await moveActionableTabManually({ queueMode, moveDirection });
		} catch (error) {
			console.error("Error moving actionable tab manually:", error);
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-off-48.png",
				title: "Actionable Tabs",
				message: "Failed to move actionable tab",
			});
		}
		return;
	}

	switch (menuItemId) {
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
	const settings = await getSettings();
	const rules = settings.rules;

	// Find the next execution time across all rules
	let nextExecutionTime = null;
	let nextDelayMinutes = 30; // default fallback

	for (const rule of rules) {
		// Skip rules with no scheduled run (empty cron expression)
		if (!rule.cronSchedule || !rule.cronSchedule.trim()) {
			continue;
		}

		const delayMinutes = parseCronToNextDelay(rule.cronSchedule);
		if (delayMinutes === null) {
			continue;
		}

		const executionTime = Date.now() + delayMinutes * 60 * 1000;

		if (!nextExecutionTime || executionTime < nextExecutionTime) {
			nextExecutionTime = executionTime;
			nextDelayMinutes = delayMinutes;
		}
	}

	// Only schedule if we have rules with cron expressions
	if (nextExecutionTime) {
		// Ensure minimum delay to prevent scheduling issues
		nextDelayMinutes = Math.max(1, nextDelayMinutes);

		await browser.alarms.clear("moveActionableTabs");

		await browser.alarms.create("moveActionableTabs", {
			delayInMinutes: nextDelayMinutes,
		});

		console.log(`Scheduled next move in ${nextDelayMinutes} minutes`);
	} else {
		// No rules with scheduled runs, clear any existing alarm
		await browser.alarms.clear("moveActionableTabs");
		console.log("No scheduled runs configured, alarm cleared");
	}
}

/**
 * Parse cron expression to get delay in minutes until next execution
 * Uses cron-parser library to handle full cron syntax
 * @param {string} cronSchedule - Cron expression (5 or 6 fields supported)
 * @returns {number|null} Delay in minutes until next cron execution, or null for no scheduled run
 */
function parseCronToNextDelay(cronSchedule) {
	const DEFAULT_DELAY_MINUTES = 30;

	// Handle empty cron expression (no scheduled run)
	if (!cronSchedule || !cronSchedule.trim()) {
		return null;
	}

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
	// Handle empty cron expression (no scheduled run)
	if (!cronSchedule || !cronSchedule.trim()) {
		return 0;
	}

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
	const settings = await getSettings();
	const rules = settings.rules;

	// Find the most recent lastMoveTime across all rules
	const mostRecentLastMoveTime = getMostRecentLastMoveTime(rules);

	if (!mostRecentLastMoveTime) {
		console.log("No lastMoveTime found - skipping catch-up check");
		return;
	}

	console.log(
		`Checking for missed moves since ${new Date(mostRecentLastMoveTime).toISOString()}`,
	);

	// Check each rule for missed moves
	let totalMissedMoves = 0;
	for (const rule of rules) {
		// Skip rules that have never run (lastMoveTime is null)
		if (!rule.lastMoveTime) {
			continue;
		}

		const missedMoves = calculateMissedMoves(
			rule.cronSchedule,
			rule.lastMoveTime,
		);
		if (missedMoves > 0) {
			console.log(`Rule ${rule.id}: ${missedMoves} missed move(s) detected`);
		}
		totalMissedMoves += missedMoves;
	}

	if (totalMissedMoves > 0) {
		console.log(
			`Found ${totalMissedMoves} missed scheduled move(s) across all rules - executing catch-up`,
		);

		await executeAllRules();

		console.log(
			`Catch-up complete - brought ${totalMissedMoves} missed move(s) current`,
		);
	} else {
		console.log("No missed moves detected");
	}
}

/**
 * Listen for settings changes and reschedule
 */
browser.storage.onChanged.addListener(async (changes, areaName) => {
	if (areaName === "sync") {
		if (changes.rules) {
			await scheduleNextMove();
			await createContextMenus();
		}
	}
});

/**
 * Handle alarm events - move actionable tabs and reschedule next execution
 */
browser.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "moveActionableTabs") {
		await executeAllRules();
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
