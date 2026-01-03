/// <reference types="./ambient.d.ts" />

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
		case "oldest":
			actionableTabsData.sort((a, b) => a.data.markedAt - b.data.markedAt);
			break;
		case "newest":
			actionableTabsData.sort((a, b) => b.data.markedAt - a.data.markedAt);
			break;
		case "leftmost":
			actionableTabsData.sort((a, b) => a.tab.index - b.tab.index);
			break;
		case "rightmost":
			actionableTabsData.sort((a, b) => b.tab.index - a.tab.index);
			break;
	}

	return actionableTabsData;
}

/**
 * Get display text for queue mode
 * @param {string} queueMode - The queue mode
 * @returns {string} Display text for the queue mode
 */
function getQueueModeDisplayText(queueMode) {
	switch (queueMode) {
		case "oldest":
			return "Oldest";
		case "newest":
			return "Newest";
		case "leftmost":
			return "Leftmost";
		case "rightmost":
			return "Rightmost";
		default:
			return queueMode;
	}
}

/**
 * Generate context menu item title for pulling actionable tabs
 * @param {string} queueMode - The queue mode
 * @param {string} moveDirection - The move direction
 * @returns {string} Context menu item title
 */
export function getContextMenuTitle(queueMode, moveDirection) {
	const queueModeText = getQueueModeDisplayText(queueMode);
	const directionText = moveDirection === "left" ? "Top/Left" : "Bottom/Right";
	const title = `Pull ${queueModeText} actionable tab to ${directionText}`;

	// Use Intl for proper sentence case formatting
	return title
		.toLocaleLowerCase("en-US")
		.replace(/^\w/, (c) => c.toLocaleUpperCase("en-US"));
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
 * Move actionable tabs using specified rule parameters
 * @param {{queueMode: string, moveDirection: string, moveCount?: number, isManual?: boolean}} params - Rule parameters to use for the move
 * @returns {Promise<{moveResults: any[], anyTabMoved: boolean, directionText: string} | null>}
 */
export async function moveActionableTabsForRule(params) {
	const { queueMode, moveDirection, moveCount = 1, isManual = false } = params;

	const actionableTabsData = await getActionableTabsSorted(queueMode);

	if (actionableTabsData.length === 0) {
		console.log("No actionable tabs to move");
		if (isManual) {
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: "No actionable tabs to pull",
			});
		}
		return null;
	}

	const targetIndex = await getTargetIndexForActionableTabs(moveDirection);
	const tabsToMove = actionableTabsData.slice(0, moveCount);

	const moveResults = await moveActionableTabs({
		actionableTabsData: tabsToMove,
		targetIndex: targetIndex,
	});

	const anyTabMoved = moveResults.some((result) => result.didMove);
	const directionText = moveDirection === "right" ? "bottom/right" : "top/left";

	if (isManual) {
		const { tab, didMove, oldIndex, newIndex } = moveResults[0];
		const queueModeText = getQueueModeDisplayText(queueMode);

		if (didMove) {
			console.log(
				`Moved actionable tab ${tab.id} (${tab.title}) from index ${oldIndex} to ${newIndex}`,
			);
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: `Pulled ${queueModeText} "${tab.title}" to ${directionText}`,
			});
		} else {
			console.log(
				`Tab ${tab.id} (${tab.title}) already at correct index ${newIndex}`,
			);
			browser.notifications.create({
				type: "basic",
				iconUrl: "icons/icon-on-48.png",
				title: "Actionable Tabs",
				message: `${queueModeText} "${tab.title}" is already at the ${directionText}`,
			});
		}
	}

	return { moveResults, anyTabMoved, directionText };
}

/**
 * Shared function to move actionable tabs
 * @param {{actionableTabsData: Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>, targetIndex: number}} params
 * @returns {Promise<Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}, oldIndex: number, newIndex: number, didMove: boolean}>>}
 */
async function moveActionableTabs({ actionableTabsData, targetIndex }) {
	/** @type {Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}, oldIndex: number, newIndex: number, didMove: boolean}>} */
	const moveResults = [];

	for (let i = 0; i < actionableTabsData.length; i++) {
		const { tabId, tab } = actionableTabsData[i];
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

	return moveResults;
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
