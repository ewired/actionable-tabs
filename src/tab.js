/// <reference types="./ambient.d.ts" />

import { DEFAULTS } from "./defaults.js";

if (typeof browser === "undefined") globalThis.browser = chrome;

/**
 * Get actionable tabs sorted according to queue mode
 * @param {string} queueMode - The queue mode setting
 * @returns {Promise<Array<{tabId: number, data: {markedAt: number}, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>>}
 */
async function getActionableTabsSorted(queueMode) {
	const allTabs = await browser.tabs.query({ currentWindow: true });
	const validTabs =
		/** @type {(import('webextension-polyfill').Tabs.Tab & {id: number})[]} */ (
			allTabs.filter((t) => t.id != null)
		);

	const actionableTabsData = [];
	for (const tab of validTabs) {
		const actionableData = /** @type {{ markedAt: number } | undefined} */ (
			await browser.sessions.getTabValue(tab.id, "actionable")
		);
		if (actionableData) {
			actionableTabsData.push({
				tabId: tab.id,
				data: actionableData,
				tab: tab,
			});
		}
	}

	switch (queueMode) {
		case "oldest-first":
			actionableTabsData.sort((a, b) => a.data.markedAt - b.data.markedAt);
			break;
		case "newest-first":
			actionableTabsData.sort((a, b) => b.data.markedAt - a.data.markedAt);
			break;
		case "leftmost-first":
			actionableTabsData.sort((a, b) => a.tab.index - b.tab.index);
			break;
		case "rightmost-first":
			actionableTabsData.sort((a, b) => b.tab.index - a.tab.index);
			break;
	}

	return actionableTabsData;
}

/**
 * Get the target index for moving actionable tabs based on moveDirection setting
 * @param {string} moveDirection - The move direction setting ('left' or 'right')
 * @returns {Promise<number>}
 */
async function getTargetIndexForActionableTabs(moveDirection) {
	const allTabs = await browser.tabs.query({ currentWindow: true });
	const validTabs =
		/** @type {(import('webextension-polyfill').Tabs.Tab & {id: number})[]} */ (
			allTabs.filter((t) => t.id != null)
		);

	if (moveDirection === "right") {
		// Move to the end of the tab strip
		return validTabs.length;
	} else {
		// Move to the left (after pinned tabs) - default behavior
		const pinnedTabs = validTabs.filter((t) => t.pinned);
		return pinnedTabs.length;
	}
}

/**
 * Move actionable tabs to top based on settings
 * @param {('left' | 'right') | undefined} manualMoveDirection - If specified, override moveCount to 1 and always show notifications
 */
export async function moveActionableTabsToTop(manualMoveDirection) {
	const settings = await browser.storage.sync.get(DEFAULTS);

	const queueMode = /** @type {string} */ (
		/** @type {{queueMode?: string}} */ (settings).queueMode ||
			/** @type {{queueMode: string}} */ (DEFAULTS).queueMode
	);

	const moveCount = manualMoveDirection
		? 1
		: /** @type {number} */ (
				/** @type {{moveCount?: number}} */ (settings).moveCount ||
					/** @type {{moveCount: number}} */ (DEFAULTS).moveCount
			);

	const moveDirection =
		manualMoveDirection ||
		/** @type {string} */ (
			/** @type {{moveDirection?: string}} */ (settings).moveDirection ||
				/** @type {{moveDirection: string}} */ (DEFAULTS).moveDirection
		);

	const actionableTabsData = await getActionableTabsSorted(queueMode);

	if (actionableTabsData.length === 0) {
		console.log("No actionable tabs to move");

		if (manualMoveDirection) {
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: "No actionable tabs to pull",
			});
		}
		return;
	}

	const targetIndex = await getTargetIndexForActionableTabs(moveDirection);
	const tabsToMove = actionableTabsData.slice(0, moveCount);

	/** @type {Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}, oldIndex: number, newIndex: number, didMove: boolean}>} */
	const moveResults = [];

	for (let i = 0; i < tabsToMove.length; i++) {
		const { tabId, tab } = tabsToMove[i];
		const oldIndex = tab.index;
		const desiredIndex = targetIndex + i;

		try {
			const movedTab = await browser.tabs.move(tabId, { index: desiredIndex });
			const newIndex = Array.isArray(movedTab)
				? movedTab[0].index
				: movedTab.index;

			const didMove = oldIndex !== newIndex;
			moveResults.push({ tabId, tab, oldIndex, newIndex, didMove });

			if (didMove) {
				console.log(
					`Moved actionable tab ${tabId} (${tab.title}) from index ${oldIndex} to ${newIndex}`,
				);
			} else {
				console.log(
					`Tab ${tabId} (${tab.title}) already at correct index ${newIndex}`,
				);
			}
		} catch (error) {
			console.error(`Error moving tab ${tabId}:`, error);
			moveResults.push({
				tabId,
				tab,
				oldIndex,
				newIndex: oldIndex,
				didMove: false,
			});
		}
	}

	const anyTabMoved = moveResults.some((result) => result.didMove);

	if (!manualMoveDirection) {
		await browser.storage.sync.set({ lastMoveTime: Date.now() });
	}

	if (manualMoveDirection) {
		if (anyTabMoved) {
			const firstResult = moveResults[0];
			const directionText =
				moveDirection === "right" ? "bottom/right" : "top/left";
			const message =
				moveResults.length === 1
					? `Pulled "${firstResult.tab.title}" to ${directionText}`
					: `Moved ${moveResults.length} actionable tab(s) to ${directionText}`;

			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: message,
			});
		} else {
			const firstResult = moveResults[0];
			const directionText =
				moveDirection === "right" ? "bottom/right" : "top/left";
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: `"${firstResult.tab.title}" is already at the ${directionText}`,
			});
		}
	} else {
		const shouldShowNotification =
			anyTabMoved &&
			/** @type {{showNotifications?: boolean}} */ (settings)
				.showNotifications !== false;

		if (shouldShowNotification) {
			const { tab } = moveResults[0];
			const directionText =
				moveDirection === "right" ? "bottom/right" : "top/left";
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
}

/**
 * Clear all actionable tabs by removing the actionable session data
 * @returns {Promise<number>} Number of tabs that were cleared
 */
export async function clearAllActionableTabs() {
	const allTabs = await browser.tabs.query({ currentWindow: true });
	const validTabs = allTabs.filter((t) => t.id != null);

	let clearedCount = 0;

	for (const tab of validTabs) {
		const tabId = /** @type {number} */ (tab.id);
		try {
			const actionableData = await browser.sessions.getTabValue(
				tabId,
				"actionable",
			);
			if (actionableData) {
				await browser.sessions.removeTabValue(tabId, "actionable");
				clearedCount++;
				console.log(`Cleared actionable state for tab ${tabId} (${tab.title})`);
			}
		} catch (error) {
			console.error(`Error clearing actionable state for tab ${tabId}:`, error);
		}
	}

	if (clearedCount > 0) {
		browser.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-off-48.png",
			title: "Actionable Tabs",
			message: `Cleared ${clearedCount} actionable tab(s)`,
		});
	}

	return clearedCount;
}
