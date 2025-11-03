export type Rule = {
	id: string;
	cronSchedule: string;
	queueMode: "oldest" | "newest" | "leftmost" | "rightmost";
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
			cronSchedule: "*/30 * * * *", // every 30 minutes (empty string = no scheduled run)
			queueMode: "leftmost",
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
 * Find the rule(s) that will execute next based on their cron schedules
 * Returns an array of rule indices that have the same earliest execution time
 */
export function getNextExecutingRulesWithParser(
	rules: Rule[],
	CronExpressionParser: {
		parse: (
			expression: string,
			options?: object,
		) => {
			next: () => { toDate: () => Date };
		};
	},
): number[] {
	let nextExecutionTime = null;
	const nextRuleIndices: number[] = [];

	for (let i = 0; i < rules.length; i++) {
		const rule = rules[i];

		// Skip rules with no scheduled run (empty cron expression)
		if (!rule.cronSchedule || !rule.cronSchedule.trim()) {
			continue;
		}

		try {
			const options = {
				currentDate: new Date(),
				strict: false,
			};

			const interval = CronExpressionParser.parse(rule.cronSchedule, options);
			const nextDate = interval.next().toDate();
			const executionTime = nextDate.getTime();

			if (!nextExecutionTime) {
				// First rule with a schedule
				nextExecutionTime = executionTime;
				nextRuleIndices.push(i);
			} else if (executionTime === nextExecutionTime) {
				// Same execution time as current earliest
				nextRuleIndices.push(i);
			} else if (executionTime < nextExecutionTime) {
				// Found earlier execution time
				nextExecutionTime = executionTime;
				nextRuleIndices.length = 0; // Clear previous indices
				nextRuleIndices.push(i);
			}
		} catch (_err) {}
	}

	return nextRuleIndices;
}

/**
 * Migrate legacy queue mode values to new values
 */
function migrateQueueMode(queueMode?: string): Rule["queueMode"] | undefined {
	switch (queueMode) {
		case "leftmost-first":
			return "leftmost";
		case "rightmost-first":
			return "rightmost";
		case "oldest-first":
			return "oldest";
		case "newest-first":
			return "newest";
		case "oldest":
		case "newest":
		case "leftmost":
		case "rightmost":
			return queueMode as Rule["queueMode"];
		default:
			return undefined;
	}
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

		// Migrate any rules with old queue mode values
		let needsRuleMigration = false;
		const migratedRules = settings.rules.map((rule) => {
			const migratedQueueMode = migrateQueueMode(rule.queueMode);
			if (migratedQueueMode && migratedQueueMode !== rule.queueMode) {
				needsRuleMigration = true;
				return { ...rule, queueMode: migratedQueueMode };
			}
			return rule;
		});

		if (needsRuleMigration) {
			console.log("Migrating rules with old queue mode values");
			settings.rules = migratedRules;
			await browser.storage.sync.set(settings);
		}

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
			queueMode:
				migrateQueueMode(settings.queueMode) || DEFAULTS.rules[0].queueMode,
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
