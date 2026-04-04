/// <reference types="./ambient.d.ts" />

import { useEffect, useState } from "preact/hooks";

type CountdownOptions = {
	preposition?: boolean;
	seconds?: boolean;
};

export function formatCountdown(
	ms: number,
	{ preposition = true, seconds = false }: CountdownOptions,
): string {
	if (seconds) {
		if (ms <= 0) return preposition ? "less than 1m ago" : "expired";

		const totalSeconds = Math.ceil(ms / 1000);
		const s = totalSeconds % 60;
		const totalMinutes = Math.floor(totalSeconds / 60);
		const m = totalMinutes % 60;
		const h = Math.floor(totalMinutes / 60);
		const value = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;

		return preposition ? `in ${value}` : value;
	}

	const m = Math.round(ms / 60_000);
	if (m < -60) {
		const value = `${Math.round(-m / 60)}h`;
		return preposition ? `${value} ago` : value;
	}
	if (m < 0) {
		const value = `${-m}m`;
		return preposition ? `${value} ago` : value;
	}
	if (m === 0) return preposition ? "less than 1m" : "0m";
	if (m < 60) return preposition ? `in ${m}m` : `${m}m`;

	const value = `${Math.round(m / 60)}h`;
	return preposition ? `in ${value}` : value;
}

type Props = {
	/** Target time as a Date, ISO string, or epoch ms. */
	target: Date | string | number | (() => Date | string | number);
	preposition?: boolean;
	seconds?: boolean;
};

/**
 * Displays a live-updating relative time for a given target date.
 * Re-renders every second while mounted.
 */
export function Countdown({ target, preposition, seconds }: Props) {
	const [display, setDisplay] = useState(() =>
		formatCountdown(resolveTargetMs(target) - Date.now(), {
			preposition,
			seconds,
		}),
	);

	useEffect(() => {
		function tick() {
			setDisplay(
				formatCountdown(resolveTargetMs(target) - Date.now(), {
					preposition,
					seconds,
				}),
			);
		}

		tick();
		const id = setInterval(tick, 1_000);
		return () => clearInterval(id);
	}, [target, preposition, seconds]);

	return <>{display}</>;
}

function resolveTargetMs(
	target: Date | string | number | (() => Date | string | number),
): number {
	return toMs(typeof target === "function" ? target() : target);
}

function toMs(target: Date | string | number): number {
	if (typeof target === "number") return target;
	if (target instanceof Date) return target.getTime();
	return new Date(target).getTime();
}
