/// <reference types="@types/webextension-polyfill" />

import { DEFAULTS } from '../defaults.js';

// Browser compatibility shim
if (typeof browser === "undefined") globalThis.browser = chrome;

/**
 * @template {HTMLElement} T
 * @overload
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
/**
 * @overload
 * @param {string} id
 * @returns {HTMLElement}
 */
/**
 * @param {string} id
 * @param {new () => HTMLElement} [type]
 * @returns {HTMLElement}
 */
const $ = (id, type) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element ${id} not found`);
    if (type && !(el instanceof type)) throw new Error(`Element ${id} is not of type ${type.name}`);
    return el;
};;

const form = $('settings', HTMLFormElement);
const msg = $('msg');
const cronInput = $('cron', HTMLInputElement);
const queueModeInput = $('queueMode', HTMLSelectElement);
const countInput = $('count', HTMLInputElement);
const notifyInput = $('notify', HTMLInputElement);
const resetBtn = $('reset', HTMLButtonElement);
const actionableEl = $('actionable');
const pinnedEl = $('pinned');
const totalEl = $('total');
const lastEl = $('last');
const nextEl = $('next');

// Load and display settings
async function load() {
    const s = /** @type {typeof DEFAULTS} */ (await browser.storage.sync.get(DEFAULTS));
    cronInput.value = s.cronSchedule;
    queueModeInput.value = s.queueMode;
    countInput.value = s.moveCount.toString();
    notifyInput.checked = s.showNotifications;

    // Load status
    const tabs = await browser.tabs.query({ currentWindow: true });

    // Count actionable tabs by checking session values
    let actionableCount = 0;
    for (const tab of tabs) {
        if (!tab.id) continue;
        const actionableData = await browser.sessions.getTabValue(tab.id, 'actionable');
        if (actionableData) {
            actionableCount++;
        }
    }

    const alarm = /** @type {any} */ (await browser.alarms.get('moveActionableTabs'));

    actionableEl.textContent = String(actionableCount);
    pinnedEl.textContent = String(tabs.filter(t => t.pinned).length);
    totalEl.textContent = String(tabs.length);
    lastEl.textContent = s.lastMoveTime ? relTime(new Date(s.lastMoveTime)) : 'Never';
    nextEl.textContent = alarm?.scheduledTime ? relTime(new Date(alarm.scheduledTime)) : 'Unknown';
}

/** @param {Event} e */
async function save(e) {
    e.preventDefault();

    const settings = {
        cronSchedule: cronInput.value.trim(),
        queueMode: queueModeInput.value,
        moveCount: parseInt(countInput.value),
        showNotifications: notifyInput.checked
    };

    if (!settings.cronSchedule) return showMsg('Cron required', true);
    if (settings.moveCount < 1 || settings.moveCount > 10) return showMsg('Count: 1-10', true);

    await browser.storage.sync.set(settings);
    showMsg('Saved');
    load();
}

// Reset to defaults
async function reset() {
    await browser.storage.sync.set(DEFAULTS);
    showMsg('Reset');
    load();
}

/** @param {string} text @param {boolean} [error=false] */
function showMsg(text, error = false) {
    msg.textContent = text;
    msg.className = error ? 'error' : '';
    setTimeout(() => msg.textContent = '', 3000);
}

/** @param {Date} d */
function relTime(d) {
    const m = Math.round((d.getTime() - new Date().getTime()) / 60000);
    if (m < -60) return `${Math.round(-m / 60)}h ago`;
    if (m < 0) return `${-m}m ago`;
    if (m < 60) return `in ${m}m`;
    return `in ${Math.round(m / 60)}h`;
}



// Event listeners
form.addEventListener('submit', save);
resetBtn.addEventListener('click', reset);

// Change detection
cronInput.addEventListener('change', () => showMsg('Unsaved changes'));
queueModeInput.addEventListener('change', () => showMsg('Unsaved changes'));
countInput.addEventListener('change', () => showMsg('Unsaved changes'));
notifyInput.addEventListener('change', () => showMsg('Unsaved changes'));

// Initialize
load();
setInterval(load, 10000); // Refresh status every 10s
