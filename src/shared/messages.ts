import type { Message } from "./types";

// ============================================================
// Message Helpers
// Type-safe wrappers around chrome.runtime.sendMessage / chrome.tabs.sendMessage
// ============================================================

/**
 * Send a message to the content script in the active tab.
 * Returns the response.
 */
export async function sendToActiveTab(message: Message): Promise<Message> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
}

/**
 * Send a message to the background service worker.
 */
export async function sendToBackground(message: Message): Promise<Message> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Listen for messages (used in content script and background).
 */
export function onMessage(
  handler: (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: Message) => void
  ) => boolean | void
): void {
  chrome.runtime.onMessage.addListener(handler);
}
