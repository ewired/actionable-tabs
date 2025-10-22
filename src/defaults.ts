/**
 * Default settings for the Actionable Tabs extension
 */
export type Settings = {
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

export const DEFAULTS: Settings = {
	cronSchedule: "*/30 * * * *", // every 30 minutes
	queueMode: "leftmost-first",
	lastMoveTime: null,
	moveCount: 1, // how many actionable tabs to move per cron execution
	moveDirection: "left", // where to move actionable tabs: 'left' (after pinned tabs) or 'right' (end of tab strip)
	showNotifications: true,
};
