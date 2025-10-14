/// <reference types="@types/webextension-polyfill" />

import { DEFAULTS } from '../defaults.js';
import { CronExpressionParser } from 'cron-parser';

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

const msg = $('msg');
const cronInput = $('cron', HTMLInputElement);
const queueModeInput = $('queueMode', HTMLSelectElement);
const countInput = $('count', HTMLInputElement);
const notifyInput = $('notify', HTMLInputElement);
const cronPresetInput = $('cronPreset', HTMLSelectElement);
const actionableEl = $('actionable');
const pinnedEl = $('pinned');
const totalEl = $('total');
const lastEl = $('last');
const nextEl = $('next');
const resetBtn = $('reset', HTMLButtonElement); // Keep for reset functionality
const clearActionableBtn = $('clearActionable', HTMLButtonElement);

// Load and display settings
async function load() {
    const s = /** @type {typeof DEFAULTS} */ (await browser.storage.sync.get(DEFAULTS));
    cronInput.value = s.cronSchedule;
    updatePresetSelector(s.cronSchedule);
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



// Reset to defaults
async function reset() {
    await browser.storage.sync.set(DEFAULTS);
    showMsg('Reset to defaults');
    load();
}

// Clear all actionable tabs
async function clearAllActionableTabs() {
    try {
        // Send message to background script to clear all actionable tabs
        const response = /** @type {any} */ (await browser.runtime.sendMessage({ 
            action: 'clearAllActionableTabs' 
        }));
        
        if (response.success) {
            showMsg(`Cleared ${response.clearedCount} actionable tab(s)`);
            load(); // Refresh the status display
        } else {
            showMsg('Failed to clear actionable tabs', true);
        }
    } catch (err) {
        console.error('Error clearing actionable tabs:', err);
        showMsg('Error clearing actionable tabs', true);
    }
}

/** @param {string} text @param {boolean} [error=false] @param {number} [duration=3000] */
function showMsg(text, error = false, duration = 3000) {
    msg.textContent = text;
    msg.className = error ? 'error' : '';
    setTimeout(() => msg.textContent = '', duration);
}

/** @param {Date} d */
function relTime(d) {
    const m = Math.round((d.getTime() - new Date().getTime()) / 60000);
    if (m < -60) return `${Math.round(-m / 60)}h ago`;
    if (m < 0) return `${-m}m ago`;
    if (m < 60) return `in ${m}m`;
    return `in ${Math.round(m / 60)}h`;
}

/** @param {string} cronExpression */
// Update preset selector based on cron expression
function updatePresetSelector(cronExpression) {
    const presets = [
        '*/1 * * * *',
        '*/5 * * * *',
        '*/15 * * * *',
        '*/30 * * * *',
        '0 * * * *',
        '0 */2 * * *',
        '0 */4 * * *',
        '0 */6 * * *',
        '0 0 * * *',
        '0 12 * * *',
        '0 0 * * 0',
        '0 0 1 * *'
    ];

    if (presets.includes(cronExpression)) {
        cronPresetInput.value = cronExpression;
    } else {
        cronPresetInput.value = 'custom';
    }
}

/** @param {string} cronExpression @returns {boolean} */
function isValidCron(cronExpression) {
    if (!cronExpression || !cronExpression.trim()) return false;
    try {
        CronExpressionParser.parse(cronExpression.trim());
        return true;
    } catch (err) {
        return false;
    }
}

/** @param {string} setting @param {any} value */
async function autoSave(setting, value) {
    try {
        await browser.storage.sync.set({ [setting]: value });
        showMsg('Settings saved');
    } catch (err) {
        showMsg('Save failed', true);
    }
}

/** @param {string} cronExpression */
async function saveCron(cronExpression) {
    const trimmedCron = cronExpression.trim();

    if (!trimmedCron) {
        cronInput.classList.add('invalid');
        showMsg('Cron expression required', true);
        return;
    }

    if (!isValidCron(trimmedCron)) {
        cronInput.classList.add('invalid');
        showMsg('Invalid cron expression', true);
        return;
    }

    cronInput.classList.remove('invalid');
    await autoSave('cronSchedule', trimmedCron);
    updatePresetSelector(trimmedCron);
    load(); // Refresh the status display to show updated next move time
}

// Event listeners
resetBtn.addEventListener('click', reset);
clearActionableBtn.addEventListener('click', clearAllActionableTabs);

// Preset selector change handler
cronPresetInput.addEventListener('change', () => {
    if (cronPresetInput.value !== 'custom') {
        cronInput.value = cronPresetInput.value;
        saveCron(cronPresetInput.value);
    }
});

// Cron input validation on input, save on blur or enter
cronInput.addEventListener('input', () => {
    const value = cronInput.value.trim();
    if (value && isValidCron(value)) {
        cronInput.classList.remove('invalid');
    } else if (value) {
        cronInput.classList.add('invalid');
    } else {
        cronInput.classList.remove('invalid');
    }
});

cronInput.addEventListener('blur', () => {
    const value = cronInput.value.trim();
    if (value && isValidCron(value)) {
        saveCron(value);
    } else if (value) {
        showMsg('Invalid cron expression', true);
    }
});

cronInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const value = cronInput.value.trim();
        if (value && isValidCron(value)) {
            saveCron(value);
        } else if (value) {
            showMsg('Invalid cron expression', true);
        }
    }
});

// Auto-save other settings on change
queueModeInput.addEventListener('change', () => {
    autoSave('queueMode', queueModeInput.value);
});

countInput.addEventListener('change', () => {
    const value = parseInt(countInput.value);
    if (value >= 1 && value <= 10) {
        autoSave('moveCount', value);
    } else {
        showMsg('Count must be between 1-10', true);
        countInput.value = '1'; // Reset to valid value
    }
});

notifyInput.addEventListener('change', () => {
    autoSave('showNotifications', notifyInput.checked);
});

// Initialize
load();
setInterval(load, 10000); // Refresh status every 10s
