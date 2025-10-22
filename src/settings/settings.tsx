/// <reference types="@types/webextension-polyfill" />

import { signal } from "@preact/signals";
import { CronExpressionParser } from "cron-parser";
import { render } from "preact";

import {
	DEFAULTS,
	getMostRecentLastMoveTime,
	getSettings,
	type Rule,
	type Settings,
} from "../storage";
import { getContextMenuTitle } from "../tab.js";

if (typeof browser === "undefined") globalThis.browser = chrome;
type Status = {
	actionable: number;
	pinned: number;
	total: number;
	lastMove: string;
	nextMove: string;
};

const initialSettings = await getSettings();

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

	// Find the most recent lastMoveTime across all rules
	const mostRecentLastMoveTime = getMostRecentLastMoveTime(
		settings.value.rules,
	);

	status.value = {
		actionable: actionableCount,
		pinned: tabs.filter((t) => t.pinned).length,
		total: tabs.length,
		lastMove: mostRecentLastMoveTime
			? relTime(new Date(mostRecentLastMoveTime))
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
	if (m === 0) return "less than 1m";
	if (m < 60) return `in ${m}m`;
	return `in ${Math.round(m / 60)}h`;
}

let debounceTimeout: number | null = null;
let pendingChanges: Partial<Settings> = {};

function autoSaveRules(rules: Rule[]): void {
	// Validate that we have at least one rule
	if (rules.length === 0) {
		console.warn("Cannot save empty rules array, keeping current rules");
		return;
	}

	settings.value = { ...settings.peek(), rules };
	pendingChanges.rules = rules;

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

function updateRule(index: number, updates: Partial<Rule>): void {
	const newRules = [...settings.value.rules];
	newRules[index] = { ...newRules[index], ...updates };
	autoSaveRules(newRules);
}

function addRule(): void {
	const newRule: Rule = {
		id: crypto.randomUUID(),
		cronSchedule: "*/30 * * * *",
		queueMode: "leftmost-first",
		lastMoveTime: null,
		moveCount: 1,
		moveDirection: "left",
		showNotifications: true,
	};
	const newRules = [...settings.value.rules, newRule];
	autoSaveRules(newRules);
}

function removeRule(index: number): void {
	// Defensive check: prevent removing the last rule even though UI prevents this scenario
	if (settings.value.rules.length <= 1) {
		console.warn("Cannot remove the last rule");
		return;
	}

	const newRules = settings.value.rules.filter((_, i) => i !== index);
	autoSaveRules(newRules);
}

function moveRule(index: number, direction: "up" | "down"): void {
	const newRules = [...settings.value.rules];
	const rule = newRules[index];
	newRules.splice(index, 1);
	const newIndex = direction === "up" ? index - 1 : index + 1;
	newRules.splice(newIndex, 0, rule);
	autoSaveRules(newRules);
}

updateStatus();

browser.storage.onChanged.addListener(async (changes, areaName) => {
	if (areaName === "sync" && changes) {
		const s = await getSettings();
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
					<legend>Rules</legend>
					{settings.value.rules.map((rule, index) => (
						<div key={rule.id} class="rule-container">
							<div class="rule-header">
								<h3>Rule {index + 1}</h3>
								<div class="rule-controls">
									{index > 0 && (
										<button
											type="button"
											onClick={() => moveRule(index, "up")}
											title="Move up"
										>
											↑
										</button>
									)}
									{index < settings.value.rules.length - 1 && (
										<button
											type="button"
											onClick={() => moveRule(index, "down")}
											title="Move down"
										>
											↓
										</button>
									)}
									{settings.value.rules.length > 1 && (
										<button
											type="button"
											onClick={() => removeRule(index)}
											class="remove"
											title="Remove rule"
										>
											×
										</button>
									)}
								</div>
							</div>

							<label>
								Schedule Preset
								<select
									value={(() => {
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
										return presets.includes(rule.cronSchedule)
											? rule.cronSchedule
											: "custom";
									})()}
									onChange={(e) => {
										const value = e.currentTarget.value;
										if (value !== "custom") {
											updateRule(index, { cronSchedule: value });
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
								<small>
									Choose a common schedule or enter custom cron below
								</small>
							</label>

							<label>
								Cron Expression
								<input
									type="text"
									value={rule.cronSchedule}
									onInput={(e) => {
										updateRule(index, { cronSchedule: e.currentTarget.value });
									}}
									class={(() => {
										if (!rule.cronSchedule || !rule.cronSchedule.trim())
											return "invalid";
										try {
											CronExpressionParser.parse(rule.cronSchedule.trim());
											return "";
										} catch (_err) {
											return "invalid";
										}
									})()}
									placeholder="*/30 * * * *"
								/>
								<small>*/15 * * * * = every 15min | 0 * * * * = hourly</small>
							</label>

							<label>
								Queue Order
								<select
									value={rule.queueMode}
									onChange={(e) => {
										const value = e.currentTarget.value as
											| "oldest-first"
											| "newest-first"
											| "leftmost-first"
											| "rightmost-first";
										updateRule(index, { queueMode: value });
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
									value={rule.moveCount}
									onChange={(e) => {
										const value = parseInt(e.currentTarget.value, 10);
										if (value >= 1 && value <= 10) {
											updateRule(index, { moveCount: value });
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
									value={rule.moveDirection}
									onChange={(e) => {
										const value = e.currentTarget.value as "left" | "right";
										updateRule(index, { moveDirection: value });
									}}
								>
									<option value="left">Left (after pinned tabs)</option>
									<option value="right">Right (end of tab strip)</option>
								</select>
								<small>Where to move actionable tabs</small>
							</label>

							<label>
								<input
									type="checkbox"
									checked={rule.showNotifications}
									onChange={(e) => {
										updateRule(index, {
											showNotifications: e.currentTarget.checked,
										});
									}}
								/>
								Show notifications
							</label>

							<div class="context-menu-info">
								<strong>Context Menu:</strong> Right-click on the Actionable
								Tabs icon and select "
								{getContextMenuTitle(rule.queueMode, rule.moveDirection)}" to
								run the rule on one tab on demand.
							</div>
						</div>
					))}

					<button type="button" onClick={addRule} class="add-rule">
						+ Add Rule
					</button>
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

				{settings.value.rules.some((rule) => {
					if (!rule.cronSchedule || !rule.cronSchedule.trim()) return true;
					try {
						CronExpressionParser.parse(rule.cronSchedule.trim());
						return false;
					} catch (_err) {
						return true;
					}
				}) && (
					<div id="msg" class="error">
						One or more rules have invalid cron expressions
					</div>
				)}

				<button
					type="button"
					onClick={async () => {
						if (
							confirm(
								"Reset all settings to defaults? This will replace all your current rules with a single default rule.",
							)
						) {
							await browser.storage.sync.set(DEFAULTS);
							await updateStatus();
						}
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
