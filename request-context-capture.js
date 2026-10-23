import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { createContextRecorder, generationEndpoint } from './request-context.js';

const recorder = createContextRecorder();
let initialized = false;
export const CONTEXT_UPDATED = 'wb-request-context-updated';
const notify = () => document.dispatchEvent(new Event(CONTEXT_UPDATED));
function chatKey() {
    const ctx = getContext();
    if (ctx.chatId === undefined || ctx.chatId === null) return null;
    return JSON.stringify([ctx.groupId ?? null, ctx.characterId ?? null, ctx.chatId]);
}
export const getLatestContext = () => recorder.get(chatKey());
export function clearLatestContext() { recorder.clear(chatKey()); notify(); }

export function initContextCapture() {
    if (initialized) return;
    initialized = true;
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => recorder.start(chatKey(), type, dryRun));
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, () => recorder.scanned());
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, entries => recorder.activated(entries));
    // Native generation reaches this point even when no worldbooks are enabled
    // (in that case WORLDINFO_SCAN_DONE and WORLD_INFO_ACTIVATED may both be absent).
    eventSource.on(event_types.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) recorder.scanned(); });
    eventSource.on(event_types.GENERATION_ENDED, () => recorder.stop());
    eventSource.on(event_types.GENERATION_STOPPED, () => recorder.stop());
    eventSource.on(event_types.CHAT_CHANGED, () => { recorder.stop(); notify(); });

    // ST 1.19 exposes the final activated list but keyword evidence only in debug
    // diagnostics. Observe those messages without suppressing or changing logging.
    const originalDebug = console.debug;
    console.debug = function (...args) {
        try { recorder.debug(args); } catch { /* Diagnostics must never affect generation. */ }
        return originalDebug.apply(this, args);
    };

    // Like ST-Memory-Context, observe serialized requests so late prompt edits are
    // included. Restrict capture to native generation endpoints during generation.
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        let endpoint;
        try { endpoint = generationEndpoint(input, window.location.href); } catch { /* Other fetch input. */ }
        let key;
        try { if (endpoint) key = chatKey(); } catch { /* Observation must not block fetch. */ }
        const capture = body => {
            try {
                if (recorder.capture(key, JSON.parse(body), endpoint)) notify();
            } catch { /* Unsupported bodies pass through unchanged. */ }
        };
        if (endpoint && typeof init?.body === 'string') capture(init.body);
        else if (endpoint && input instanceof Request && init?.body === undefined) {
            // Reading a clone preserves the original stream, headers and signal.
            try {
                const copy = input.clone();
                return copy.text().then(body => {
                    capture(body);
                    return originalFetch.call(this, input, init);
                }, () => originalFetch.call(this, input, init));
            } catch { /* Already consumed Request: let fetch handle it normally. */ }
        }
        return originalFetch.call(this, input, init);
    };
}
