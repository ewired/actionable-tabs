import { nanoid } from "nanoid";

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
export type Settings = {
	/**
	 * Rules for moving tabs. Rules that run on the same schedule will respect
	 * the order, so there are controls to re-order the rules.
	 */
	rules: Rule[];
};

export const DEFAULTS: Settings = {
	rules: [
		{
			id: nanoid(),
			cronSchedule: "*/30 * * * *", // every 30 minutes
			queueMode: "leftmost-first",
			lastMoveTime: null,
			moveCount: 1, // how many actionable tabs to move per cron execution
			moveDirection: "left", // where to move actionable tabs: 'left' (after pinned tabs) or 'right' (end of tab strip)
			showNotifications: true,
		},
	],
};
