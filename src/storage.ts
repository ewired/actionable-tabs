export type Rule = {
	id: string;
	cronSchedule: string;
	queueMode:
		| "oldest-first"
		| "newest-first"
		| "leftmost-first"
		| "rightmost-first";
	lastMoveTime: number | null;
	moveCount: number;
	moveDirection: "left" | "right";
	showNotifications: boolean;
};

/**
 * Default settings for the Actionable Tabs extension
 */
type LegacySettings = {
	cronSchedule?: string;
	queueMode?: Rule["queueMode"];
	lastMoveTime?: number | null;
	moveCount?: number;
	moveDirection?: Rule["moveDirection"];
	showNotifications?: boolean;
};

export type Settings = {
	/**
	 * Version of the settings format. undefined = legacy format, 1 = rules-based format
	 */
	version?: 1;
	/**
	 * Rules for moving tabs. Rules that run on the same schedule will respect
	 * the order, so there are controls to re-order the rules.
	 */
	rules: Rule[];
};

export const DEFAULTS: Settings = {
	version: 1,
	rules: [
		{
			id: "default-rule-001",
			cronSchedule: "*/30 * * * *", // every 30 minutes
			queueMode: "leftmost-first",
			lastMoveTime: null,
			moveCount: 1, // how many actionable tabs to move per cron execution
			moveDirection: "left", // where to move actionable tabs: 'left' (after pinned tabs) or 'right' (end of tab strip)
			showNotifications: true,
		},
	],
};

/**
 * Find the most recent lastMoveTime across all rules
 */
export function getMostRecentLastMoveTime(rules: Rule[]): number | null {
	let mostRecentLastMoveTime = null;
	for (const rule of rules) {
		if (
			rule.lastMoveTime &&
			(!mostRecentLastMoveTime || rule.lastMoveTime > mostRecentLastMoveTime)
		) {
			mostRecentLastMoveTime = rule.lastMoveTime;
		}
	}
	return mostRecentLastMoveTime;
}

/**
 * Get settings from storage, handling migration from legacy format
 */
export async function getSettings(): Promise<Settings> {
	const settings = (await browser.storage.sync.get()) as Settings &
		LegacySettings;

	// Check if we have version 1 settings (new format)
	if (settings.version === 1) {
		// Already using v1, ensure defaults are applied
		const settingsWithDefaults = await browser.storage.sync.get(DEFAULTS);
		const settings = settingsWithDefaults as Settings;

		// Ensure there's always at least one rule
		if (!settings.rules || settings.rules.length === 0) {
			console.warn("Settings validation: No rules found, adding default rule");
			settings.rules = [DEFAULTS.rules[0]];
			await browser.storage.sync.set(settings);
		}

		return structuredClone(settings);
	}

	// Check if we need to migrate from old settings format
	const needsMigration =
		settings.cronSchedule !== undefined ||
		settings.queueMode !== undefined ||
		settings.lastMoveTime !== undefined ||
		settings.moveCount !== undefined ||
		settings.moveDirection !== undefined ||
		settings.showNotifications !== undefined;

	if (needsMigration) {
		console.log("Migrating old settings to new rules format");

		// Create a rule from the old settings
		const migratedRule: Rule = {
			id: "legacy",
			cronSchedule: settings.cronSchedule || DEFAULTS.rules[0].cronSchedule,
			queueMode: settings.queueMode || DEFAULTS.rules[0].queueMode,
			lastMoveTime: settings.lastMoveTime || null,
			moveCount: settings.moveCount || DEFAULTS.rules[0].moveCount,
			moveDirection: settings.moveDirection || DEFAULTS.rules[0].moveDirection,
			showNotifications:
				settings.showNotifications !== undefined
					? settings.showNotifications
					: DEFAULTS.rules[0].showNotifications,
		};

		// Create new settings with the migrated rule and version
		const newSettings: Settings = {
			version: 1,
			rules: [migratedRule],
		};

		// Ensure there's always at least one rule
		if (!newSettings.rules || newSettings.rules.length === 0) {
			console.warn("Settings validation: No rules found, adding default rule");
			newSettings.rules = [DEFAULTS.rules[0]];
		}

		await browser.storage.sync.set(newSettings);

		// Clean up old global settings to avoid confusion
		await browser.storage.sync.remove([
			"cronSchedule",
			"queueMode",
			"lastMoveTime",
			"moveCount",
			"moveDirection",
			"showNotifications",
		]);

		console.log(
			"Migration complete - old settings cleaned up, new v1 settings added",
		);
		return structuredClone(newSettings);
	} else {
		// No existing settings, initialize with v1 defaults
		const defaultsWithVersion: Settings = {
			version: 1,
			...DEFAULTS,
		};

		// Ensure there's always at least one rule
		if (!defaultsWithVersion.rules || defaultsWithVersion.rules.length === 0) {
			console.warn("Settings validation: No rules found, adding default rule");
			defaultsWithVersion.rules = [DEFAULTS.rules[0]];
		}

		await browser.storage.sync.set(defaultsWithVersion);
		return structuredClone(defaultsWithVersion);
	}
}
