/// <reference types="./ambient.d.ts" />

if (typeof browser === "undefined") globalThis.browser = chrome;

/**
 * Get actionable tabs sorted according to queue mode
 * @param {string} queueMode - The queue mode setting
 * @returns {Promise<Array<{tabId: number, data: {markedAt: number}, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>>}
 */
export async function getActionableTabsSorted(queueMode) {
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
 * Get display text for queue mode
 * @param {string} queueMode - The queue mode
 * @returns {string} Display text for the queue mode
 */
function getQueueModeDisplayText(queueMode) {
	switch (queueMode) {
		case "oldest-first":
			return "Oldest";
		case "newest-first":
			return "Newest";
		case "leftmost-first":
			return "Leftmost";
		case "rightmost-first":
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
export async function getTargetIndexForActionableTabs(moveDirection) {
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
 * Manually move one actionable tab using specified rule parameters
 * @param {{queueMode: string, moveDirection: string}} ruleParams - Rule parameters to use for the move
 */
export async function moveActionableTabManually(ruleParams) {
	const { queueMode, moveDirection } = ruleParams;

	const actionableTabsData = await getActionableTabsSorted(queueMode);

	if (actionableTabsData.length === 0) {
		console.log("No actionable tabs to move");
		browser.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-on-48.png",
			title: "Actionable Tabs",
			message: "No actionable tabs to pull",
		});
		return;
	}

	// Use shared function to move tabs
	const moveResults = await moveActionableTabs({
		actionableTabsData: actionableTabsData.slice(0, 1), // Only move first tab for manual
		targetIndex: await getTargetIndexForActionableTabs(moveDirection),
	});

	// Handle manual-specific notifications
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
			message: `Pulled ${queueModeText} "${tab.title}" to ${moveDirection === "left" ? "top/left" : "bottom/right"}`,
		});
	} else {
		console.log(
			`Tab ${tab.id} (${tab.title}) already at correct index ${newIndex}`,
		);
		browser.notifications.create({
			type: "basic",
			iconUrl: "icons/icon-on-48.png",
			title: "Actionable Tabs",
			message: `${queueModeText} "${tab.title}" is already at the ${moveDirection === "left" ? "top/left" : "bottom/right"}`,
		});
	}
}

/**
 * Shared function to move actionable tabs
 * @param {{actionableTabsData: Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}}>, targetIndex: number}} params
 * @returns {Promise<Array<{tabId: number, tab: import('webextension-polyfill').Tabs.Tab & {id: number}, oldIndex: number, newIndex: number, didMove: boolean}>>}
 */
export async function moveActionableTabs({ actionableTabsData, targetIndex }) {
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
