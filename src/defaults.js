/**
 * Default settings for the Actionable Tabs extension
 * @type {{
 *   cronSchedule: string;
 *   queueMode: 'oldest-first' | 'newest-first' | 'leftmost-first' | 'rightmost-first';
 *   lastMoveTime: number | null;
 *   moveCount: number;
 *   showNotifications: boolean;
 * }}
 */
export const DEFAULTS = {
    cronSchedule: '*/30 * * * *', // every 30 minutes
    queueMode: 'leftmost-first',
    lastMoveTime: null,
    moveCount: 1, // how many actionable tabs to move per cron execution
    showNotifications: true
};