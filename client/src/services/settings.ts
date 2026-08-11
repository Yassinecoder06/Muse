const KEY = 'muse-chat-model'
export function chatModel() { return localStorage.getItem(KEY) || '' }
export function setChatModel(model: string) { if (model) localStorage.setItem(KEY, model); else localStorage.removeItem(KEY) }