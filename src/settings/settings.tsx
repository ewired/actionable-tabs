/// <reference types="@types/webextension-polyfill" />

import { computed, signal } from "@preact/signals";
import { CronExpressionParser } from "cron-parser";
import { render } from "preact";

import { DEFAULTS } from "../defaults.js";

if (typeof browser === "undefined") globalThis.browser = chrome;

type Settings = typeof DEFAULTS;
type Status = {
	actionable: number;
	pinned: number;
	total: number;
	lastMove: string;
	nextMove: string;
};

const initialSettings = (await browser.storage.sync.get(DEFAULTS)) as Settings;
const settings = signal<Settings>(initialSettings);
const status = signal<Status>({
	actionable: 0,
	pinned: 0,
	total: 0,
	lastMove: "Never",
	nextMove: "Unknown",
});

const isLoading = signal<boolean>(true);
const saveStatus = signal<"idle" | "saving" | "saved" | "error">("idle");

const cronPreset = computed(() => {
	const presets = [
		"*/1 * * * *",
		"*/5 * * * *",
		"*/15 * * * *",
		"*/30 * * * *",
		"0 * * * *",
		"0 */2 * * *",
		"0 */4 * * *",
		"0 */6 * * *",
		"0 0 * * *",
		"0 12 * * *",
		"0 0 * * 0",
		"0 0 1 * *",
	];

	return presets.includes(settings.value.cronSchedule)
		? settings.value.cronSchedule
		: "custom";
});

const isValidCron = computed(() => {
	const cronExpression = settings.value.cronSchedule;
	if (!cronExpression || !cronExpression.trim()) return false;
	try {
		CronExpressionParser.parse(cronExpression.trim());
		return true;
	} catch (_err) {
		return false;
	}
});

async function updateStatus(): Promise<void> {
	const tabs = await browser.tabs.query({ currentWindow: true });

	let actionableCount = 0;
	for (const tab of tabs) {
		if (!tab.id) continue;
		const actionableData = await browser.sessions.getTabValue(
			tab.id,
			"actionable",
		);
		if (actionableData) {
			actionableCount++;
		}
	}

	const alarm = await browser.alarms.get("moveActionableTabs");

	status.value = {
		actionable: actionableCount,
		pinned: tabs.filter((t) => t.pinned).length,
		total: tabs.length,
		lastMove: settings.value.lastMoveTime
			? relTime(new Date(settings.value.lastMoveTime))
			: "Never",
		nextMove: alarm?.scheduledTime
			? relTime(new Date(alarm.scheduledTime))
			: "Unknown",
	};
	isLoading.value = false;
}

async function clearAllActionableTabs(): Promise<void> {
	try {
		const response = (await browser.runtime.sendMessage({
			action: "clearAllActionableTabs",
		})) as { success: boolean; clearedCount?: number };

		if (response.success) {
			await updateStatus();
		}
	} catch (err) {
		console.error("Error clearing actionable tabs:", err);
	}
}

function relTime(d: Date): string {
	const m = Math.round((d.getTime() - Date.now()) / 60000);
	if (m < -60) return `${Math.round(-m / 60)}h ago`;
	if (m < 0) return `${-m}m ago`;
	if (m < 60) return `in ${m}m`;
	return `in ${Math.round(m / 60)}h`;
}

let debounceTimeout: number | null = null;
let pendingChanges: Partial<Settings> = {};

function autoSave<Key extends keyof Settings>(
	setting: Key,
	value: Settings[Key],
): void {
	settings.value = { ...settings.peek(), [setting]: value };
	pendingChanges[setting] = value;

	if (debounceTimeout !== null) {
		clearTimeout(debounceTimeout);
	}

	saveStatus.value = "saving";
	debounceTimeout = setTimeout(async () => {
		try {
			await browser.storage.sync.set(pendingChanges);
			pendingChanges = {};
			saveStatus.value = "saved";
		} catch (_err) {
			saveStatus.value = "error";
		}
	}, 500);
}

updateStatus();

browser.storage.onChanged.addListener(async (changes, areaName) => {
	if (areaName === "sync" && changes) {
		const s = (await browser.storage.sync.get(DEFAULTS)) as Settings;
		settings.value = s;
		await updateStatus();
	}
});
browser.tabs.onCreated.addListener(updateStatus);
browser.tabs.onRemoved.addListener(updateStatus);
browser.tabs.onUpdated.addListener(updateStatus);

function App() {
	if (isLoading.value) {
		return (
			<div>
				<h1>ACTIONABLE TABS</h1>
				<div id="settings">
					<p>Loading settings...</p>
				</div>
			</div>
		);
	}

	return (
		<div>
			<h1>ACTIONABLE TABS</h1>
			{saveStatus.value !== "idle" && (
				<div id="save-status" class={saveStatus.value}>
					{saveStatus.value === "saving" && "Saving..."}
					{saveStatus.value === "saved" && "✓ Saved"}
					{saveStatus.value === "error" && "✗ Error saving"}
				</div>
			)}
			<div id="settings">
				<fieldset>
					<legend>Schedule</legend>
					<label>
						Schedule Preset
						<select
							value={cronPreset.value}
							onChange={(e) => {
								const value = e.currentTarget.value;
								if (value !== "custom") {
									autoSave("cronSchedule", value);
								}
							}}
						>
							<option value="*/1 * * * *">Every minute</option>
							<option value="*/5 * * * *">Every 5 minutes</option>
							<option value="*/15 * * * *">Every 15 minutes</option>
							<option value="*/30 * * * *">Every 30 minutes</option>
							<option value="0 * * * *">Hourly</option>
							<option value="0 */2 * * *">Every 2 hours</option>
							<option value="0 */4 * * *">Every 4 hours</option>
							<option value="0 */6 * * *">Every 6 hours</option>
							<option value="0 0 * * *">Daily (midnight)</option>
							<option value="0 12 * * *">Daily (noon)</option>
							<option value="0 0 * * 0">Weekly (Sunday midnight)</option>
							<option value="0 0 1 * *">Monthly (1st of month)</option>
							<option value="custom">Custom</option>
						</select>
						<small>Choose a common schedule or enter custom cron below</small>
					</label>
					<label>
						Cron Expression
						<input
							type="text"
							value={settings.value.cronSchedule}
							onInput={(e) => {
								autoSave("cronSchedule", e.currentTarget.value);
							}}
							class={!isValidCron.value ? "invalid" : ""}
							placeholder="*/30 * * * *"
						/>
						<small>*/15 * * * * = every 15min | 0 * * * * = hourly</small>
					</label>
				</fieldset>

				<fieldset>
					<legend>Queue</legend>
					<label>
						Queue Order
						<select
							value={settings.value.queueMode}
							onChange={(e) => {
								const value = e.currentTarget.value as
									| "oldest-first"
									| "newest-first"
									| "leftmost-first"
									| "rightmost-first";
								autoSave("queueMode", value);
							}}
						>
							<option value="oldest-first">Oldest First (FIFO)</option>
							<option value="newest-first">Newest First (LIFO)</option>
							<option value="leftmost-first">Leftmost First</option>
							<option value="rightmost-first">Rightmost First</option>
						</select>
						<small>How to choose which actionable tabs to move</small>
					</label>
					<label>
						Tabs per cycle
						<input
							type="number"
							value={settings.value.moveCount}
							onChange={(e) => {
								const value = parseInt(e.currentTarget.value, 10);
								if (value >= 1 && value <= 10) {
									autoSave("moveCount", value);
								}
							}}
							min="1"
							max="10"
							required
						/>
					</label>
					<label>
						Move Direction
						<select
							value={settings.value.moveDirection}
							onChange={(e) => {
								const value = e.currentTarget.value as "left" | "right";
								autoSave("moveDirection", value);
							}}
						>
							<option value="left">Left (after pinned tabs)</option>
							<option value="right">Right (end of tab strip)</option>
						</select>
						<small>Where to move actionable tabs</small>
					</label>
				</fieldset>

				<fieldset>
					<legend>Options</legend>
					<label>
						<input
							type="checkbox"
							checked={settings.value.showNotifications}
							onChange={(e) => {
								autoSave("showNotifications", e.currentTarget.checked);
							}}
						/>
						Show notifications
					</label>
				</fieldset>

				<fieldset>
					<legend>Status</legend>
					<dl>
						<dt>Actionable</dt>
						<dd>{status.value.actionable}</dd>
						<dt>Pinned</dt>
						<dd>{status.value.pinned}</dd>
						<dt>Total</dt>
						<dd>{status.value.total}</dd>
						<dt>Last move</dt>
						<dd>{status.value.lastMove}</dd>
						<dt>Next move</dt>
						<dd>{status.value.nextMove}</dd>
					</dl>
				</fieldset>

				{!isValidCron.value && (
					<div id="msg" class="error">
						Invalid cron expression
					</div>
				)}

				<button
					type="button"
					onClick={async () => {
						await browser.storage.sync.set(DEFAULTS);
						await updateStatus();
					}}
				>
					RESET
				</button>
				<button
					type="button"
					id="clearActionable"
					onClick={clearAllActionableTabs}
				>
					CLEAR ALL ACTIONABLE TABS
				</button>
			</div>
		</div>
	);
}

const appElement = document.getElementById("app");
if (appElement) {
	render(<App />, appElement);
}
