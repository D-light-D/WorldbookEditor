import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { createActivationRecorder } from './activation-records.js';
import { createOutputTrace } from './activation-output.js';

const recorder = createActivationRecorder();
let initialized = false;
let trace = null;
let activeKey = null;
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
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        activeKey = dryRun ? null : chatKey();
        trace = null;
        recorder.start(activeKey, type, dryRun);
    });
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, () => recorder.scanned());
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, entries => {
        recorder.activated(entries);
        trace = createOutputTrace(recorder.pendingEntries(), crypto.randomUUID());
    });
    // Publish after native prompt preparation, including known empty results.
    // The prompt argument is never inspected or retained.
    eventSource.on(event_types.GENERATE_AFTER_DATA, (_data, dryRun) => {
        if (dryRun) return;
        recorder.scanned();
    });
    // ST-Prompt-Template prepares this context immediately before evaluating the
    // assembled messages. Tag only that in-flight copy, never worldbooks or chats.
    eventSource.on('prompt_template_prepare', context => {
        if (activeKey !== null && context.runType === 'generate' && !context.isDryRun && context.generateData) trace?.tag(context.generateData);
    });
    eventSource.on(event_types.GENERATION_ENDED, () => { activeKey = null; recorder.stop(); });
    eventSource.on(event_types.GENERATION_STOPPED, () => { activeKey = null; recorder.stop(); });
    eventSource.on(event_types.CHAT_CHANGED, () => { activeKey = null; recorder.stop(); notify(); });

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        let endpoint;
        try {
            const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), window.location.href);
            endpoint = url.origin === window.location.origin && /^\/api\/(?:backends\/(?:chat-completions|text-completions|kobold|koboldhorde)|novelai)\/generate$/.test(url.pathname);
        } catch { /* Pass unrelated requests through. */ }
        if (!endpoint) return originalFetch.call(this, input, init);
        const requestTrace = trace;
        const key = activeKey;
        const process = body => {
            const payload = JSON.parse(body);
            const outputTrace = requestTrace ?? createOutputTrace(recorder.pendingEntries(), crypto.randomUUID());
            const outputs = outputTrace.finish(payload);
            if (key !== null && key === chatKey()) {
                recorder.scanned();
                if (recorder.capture(key, outputs)) notify();
            }
            return JSON.stringify(payload);
        };
        if (typeof init?.body === 'string') {
            // If tagged data cannot be decoded, fail closed rather than sending tags.
            return originalFetch.call(this, input, { ...init, body: process(init.body) });
        }
        if (input instanceof Request && init?.body === undefined) {
            return input.clone().text().then(body => originalFetch.call(this, new Request(input, { ...init, body: process(body) })));
        }
        return originalFetch.call(this, input, init);
    };

    // ST 1.19 exposes keyword evidence only in existing debug diagnostics.
    const originalDebug = console.debug;
    console.debug = function (...args) {
        try { recorder.debug(args); } catch { /* Observation must never affect generation. */ }
        return originalDebug.apply(this, args);
    };
}
