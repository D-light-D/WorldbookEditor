import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { createActivationRecorder } from './activation-records.js';

const recorder = createActivationRecorder();
let initialized = false;
export const ACTIVATIONS_UPDATED = 'wb-activations-updated';
const notify = () => document.dispatchEvent(new Event(ACTIVATIONS_UPDATED));
function chatKey() {
    const ctx = getContext();
    if (ctx.chatId === undefined || ctx.chatId === null) return null;
    return JSON.stringify([ctx.groupId ?? null, ctx.characterId ?? null, ctx.chatId]);
}
export const getLatestActivations = () => recorder.get(chatKey());

export function initActivationCapture() {
    if (initialized) return;
    initialized = true;
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => recorder.start(chatKey(), type, dryRun));
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, () => recorder.scanned());
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, entries => recorder.activated(entries));
    // Publish after native prompt preparation, including known empty results.
    // The prompt argument is never inspected or retained.
    eventSource.on(event_types.GENERATE_AFTER_DATA, (_data, dryRun) => {
        if (dryRun) return;
        recorder.scanned();
        if (recorder.capture(chatKey())) notify();
    });
    eventSource.on(event_types.GENERATION_ENDED, () => recorder.stop());
    eventSource.on(event_types.GENERATION_STOPPED, () => recorder.stop());
    eventSource.on(event_types.CHAT_CHANGED, () => { recorder.stop(); notify(); });

    // ST 1.19 exposes keyword evidence only in existing debug diagnostics.
    const originalDebug = console.debug;
    console.debug = function (...args) {
        try { recorder.debug(args); } catch { /* Observation must never affect generation. */ }
        return originalDebug.apply(this, args);
    };
}
