/// <reference types="./ambient.d.ts" />

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Countdown } from "./countdown";
import { DEFAULTS } from "./storage";

if (typeof browser === "undefined") globalThis.browser = chrome;

function getSnoozeRemainingMs(snoozeUntil: unknown): number | undefined {
	if (typeof snoozeUntil !== "string") return undefined;
	const ms = new Date(snoozeUntil).getTime() - Date.now();
	return ms > 0 ? ms : undefined;
}

export async function isSnoozeActive(): Promise<boolean> {
	const { snoozeUntil } = await browser.storage.sync.get("snoozeUntil");
	return getSnoozeRemainingMs(snoozeUntil) !== undefined;
}

export async function toggleGlobalSnooze(
	snoozeMinutesOverride?: number,
): Promise<string | undefined> {
	const current = await browser.storage.sync.get([
		"snoozeUntil",
		"snoozeMinutes",
	]);

	const newSnoozeUntil =
		getSnoozeRemainingMs(current.snoozeUntil) !== undefined
			? undefined
			: new Date(
					Date.now() +
						(snoozeMinutesOverride ??
							(Number(current.snoozeMinutes) || DEFAULTS.snoozeMinutes)) *
							60_000,
				).toISOString();

	await browser.storage.sync.set({ snoozeUntil: newSnoozeUntil });
	return newSnoozeUntil;
}

function updateSnoozeMinutesSetting(minutes: number): void {
	if (minutes < 1 || minutes > 1440) {
		console.warn("Snooze minutes must be between 1 and 1440");
		return;
	}
	browser.storage.sync.set({ snoozeMinutes: minutes });
}

type SnoozePanelProps = {
	initialSnoozeMinutes?: number;
	initialSnoozeUntil?: string;
};

export function SnoozePanel({
	initialSnoozeMinutes,
	initialSnoozeUntil,
}: SnoozePanelProps) {
	const snoozeUntil = useSignal<string | undefined>(initialSnoozeUntil);
	const snoozeMinutes = useSignal<number>(
		initialSnoozeMinutes ?? DEFAULTS.snoozeMinutes,
	);
	const active = useSignal(
		getSnoozeRemainingMs(initialSnoozeUntil) !== undefined,
	);

	useEffect(() => {
		const handleStorageChange: Parameters<
			typeof browser.storage.onChanged.addListener
		>[0] = (changes, areaName) => {
			if (areaName !== "sync") return;
			if ("snoozeUntil" in changes) {
				snoozeUntil.value = changes.snoozeUntil.newValue as string | undefined;
				active.value =
					getSnoozeRemainingMs(changes.snoozeUntil.newValue) !== undefined;
			}
			if ("snoozeMinutes" in changes) {
				snoozeMinutes.value =
					(changes.snoozeMinutes.newValue as number | undefined) ??
					DEFAULTS.snoozeMinutes;
			}
		};

		browser.storage.onChanged.addListener(handleStorageChange);
		return () => browser.storage.onChanged.removeListener(handleStorageChange);
	}, []);

	useEffect(() => {
		function checkSnoozeStatus() {
			active.value = getSnoozeRemainingMs(snoozeUntil.value) !== undefined;
		}

		checkSnoozeStatus();

		const id = setInterval(checkSnoozeStatus, 1000);
		return () => clearInterval(id);
	}, []);

	const minutes = snoozeMinutes.value;

	return (
		<fieldset>
			<legend>Snooze</legend>
			<div
				style={{
					display: "flex",
					gap: "16px",
					alignItems: "flex-start",
					flexWrap: "wrap",
				}}
			>
				<label style={{ flex: "1", minWidth: "200px" }}>
					Snooze Duration (minutes)
					<input
						type="number"
						value={minutes}
						onChange={(e) => {
							const v = Number.parseInt(e.currentTarget.value, 10);
							if (v >= 1 && v <= 1440) {
								snoozeMinutes.value = v;
								updateSnoozeMinutesSetting(v);
							} else if (e.currentTarget.value === "") {
								snoozeMinutes.value = DEFAULTS.snoozeMinutes;
								updateSnoozeMinutesSetting(DEFAULTS.snoozeMinutes);
							}
						}}
						min="1"
						max="1440"
						required
					/>
					<small>How long rules are snoozed (1-1440 minutes)</small>
				</label>
				<button
					type="button"
					onClick={() => toggleGlobalSnooze(minutes)}
					class={active.value ? "snooze-active" : undefined}
				>
					{active.value ? "Cancel snooze" : "Snooze now"}
				</button>
			</div>
			{active.value && (
				<small
					style={{
						display: "block",
						marginTop: "12px",
						padding: "8px 12px",
						backgroundColor: "#e7f3ff",
						borderRadius: "4px",
						color: "#0066cc",
					}}
				>
					Snooze active:{" "}
					<Countdown
						target={snoozeUntil.value ?? ""}
						preposition={false}
						seconds
					/>{" "}
					remaining
				</small>
			)}
		</fieldset>
	);
}
