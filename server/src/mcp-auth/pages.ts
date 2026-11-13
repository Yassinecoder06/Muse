import { escapeHtml } from '../utils/html.js'
import type { ApprovalMode, McpScope } from './internal.js'

/**
 * Server-rendered pages for the public OAuth / approval flow. The CSP allows
 * inline styles only (no scripts, no external resources), so everything here is
 * plain HTML + CSS that works without JavaScript.
 */

export const SCOPE_INFO: Record<McpScope, { label: string; description: string; sensitive?: boolean }> = {
  'notes:read': { label: 'Read notes', description: 'Search and read your notes and collections.' },
  'notes:write': { label: 'Write notes', description: 'Create, edit, organise and trash notes.' },
  tasks: { label: 'Tasks', description: 'List, create, complete and delete tasks.' },
  calendar: { label: 'Calendar', description: 'See and manage your calendar events.' },
  memory: { label: 'Memory', description: "Read and update Bip's long-term memory about you." },
  templates: { label: 'Templates', description: 'Use and manage specialised note templates.' },
  images: { label: 'Images', description: 'Generate images with your configured AI providers.' },
  research: { label: 'Research', description: 'Run deep research jobs that write reports into notes.' },
  web: { label: 'Web access', description: 'Search and fetch web pages from your server.', sensitive: true },
  code: { label: 'Run code', description: 'Execute code in Muse\'s sandbox.', sensitive: true }
}

const MODES: { id: ApprovalMode; title: string; description: string }[] = [
  { id: 'minimal', title: 'Minimal', description: 'The app asks you before deleting anything.' },
  { id: 'standard', title: 'Standard', description: 'Deletions also need your approval in Muse.' },
  { id: 'trust', title: 'Trust', description: 'Never asks. Deletions keep a 7-day undo.' }
]

const LOGO = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.35 6.15L20.5 11l-6.15 2.35L12 19.5l-2.35-6.15L3.5 11l6.15-2.35z"/></svg>`
const CHECK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`

const STYLE = `
:root{--bg:#f5f4f8;--surface:#fff;--border:#e6e3ec;--text:#22202a;--muted:#77737f;--accent:#6f5fd0;--accent-ink:#fff;--accent-soft:#efebff;--warn:#a5631b;--warn-soft:#fdf3e4;--danger:#c2453d;--danger-ink:#fff;--danger-soft:#fdecea;--ok:#2f7d57;--ok-soft:#e7f5ed;--field:#faf9fc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141318;--surface:#1f1e25;--border:#33313b;--text:#ecebf1;--muted:#9c98a6;--accent:#a996ff;--accent-ink:#17151f;--accent-soft:#2b2640;--warn:#f0b46a;--warn-soft:#3a2c1a;--danger:#f0938b;--danger-ink:#2a1210;--danger-soft:#3b1f1d;--ok:#7fd1a5;--ok-soft:#1b3328;--field:#18171d;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px 16px}
.brand{display:flex;align-items:center;gap:8px;color:var(--accent);font-weight:700;letter-spacing:.2px;margin-bottom:18px}
.brand span{color:var(--text)}
main{width:100%;max-width:520px;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 30px rgba(20,15,40,.06)}
.head{padding:28px 28px 20px;border-bottom:1px solid var(--border)}
.head h1{font-size:22px;line-height:1.25;margin:0}
.head p{margin:6px 0 0;color:var(--muted);font-size:14px}
.app{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.avatar{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:700;font-size:19px}
.app small{display:block;color:var(--muted);font-size:12.5px}
.body{padding:22px 28px 28px;display:grid;gap:22px}
fieldset{border:0;margin:0;padding:0;min-width:0}
legend,.label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px;padding:0}
.scopes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.scope{position:relative;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--field)}
.scope input{position:absolute;opacity:0;pointer-events:none}
.box{flex:none;width:18px;height:18px;margin-top:2px;border-radius:5px;border:1.5px solid var(--border);display:grid;place-items:center;color:transparent;background:var(--surface)}
.scope strong{display:block;font-size:13.5px}
.scope small{display:block;color:var(--muted);font-size:12px;line-height:1.35}
.scope:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.scope:has(input:checked) .box{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.scope:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-size:10.5px;font-weight:700;vertical-align:1px}
.modes{display:grid;gap:8px}
.mode{display:flex;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--field)}
.mode input{accent-color:var(--accent);width:16px;height:16px;margin:0;flex:none}
.mode strong{font-size:14px}
.mode small{display:block;color:var(--muted);font-size:12.5px}
.mode:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.hint{margin:8px 0 0;color:var(--muted);font-size:12.5px}
.field{display:grid;gap:6px}
.field input{width:100%;font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--border);background:var(--field);color:var(--text)}
.field input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
.remember{display:flex;gap:8px;align-items:center;font-size:14px;cursor:pointer}
.remember input{accent-color:var(--accent);width:16px;height:16px;margin:0}
.actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.btn{font:inherit;font-weight:600;border-radius:10px;padding:11px 18px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.danger{background:var(--danger);border-color:var(--danger);color:var(--danger-ink)}
.btn:hover{filter:brightness(.97)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.alert{padding:11px 14px;border-radius:10px;font-size:13.5px;background:var(--danger-soft);color:var(--danger)}
.alert.ok{background:var(--ok-soft);color:var(--ok)}
.details{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:14px}
.details dt{color:var(--muted)}
.details dd{margin:0;word-break:break-word}
.details code{font-size:13px;background:var(--field);border:1px solid var(--border);border-radius:6px;padding:1px 6px}
.icon{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;margin-bottom:14px;background:var(--accent-soft);color:var(--accent)}
.icon.ok{background:var(--ok-soft);color:var(--ok)}
.icon.bad{background:var(--danger-soft);color:var(--danger)}
footer{margin-top:18px;color:var(--muted);font-size:12.5px;text-align:center;max-width:520px}
@media (max-width:520px){body{padding:20px 12px}.head,.body{padding-left:18px;padding-right:18px}.scopes{grid-template-columns:1fr}.actions .btn{flex:1}}
`

export function renderPage(title: string, content: string, footer = 'Muse · your private notes, connected on your terms.'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Muse</title><style>${STYLE}</style></head><body><div class="brand">${LOGO}<span>Muse</span></div><main>${content}</main><footer>${escapeHtml(footer)}</footer></body></html>`
}

function hostOf(url: string) {
  try { return new URL(url).host } catch { return url }
}

export interface ConsentView {
  csrf: string
  clientId: string
  clientName: string
  redirectUri: string
  challenge: string
  state: string
  /** Scopes offered on the page, in display order. */
  offered: McpScope[]
  /** Scopes ticked when the page loads. */
  checked: McpScope[]
  mode: ApprovalMode
  remembered: boolean
  denyUrl: string
  error?: string
}

export function consentPage(view: ConsentView): string {
  const name = view.clientName.trim() || 'An app'
  const hidden = [['csrf', view.csrf], ['client_id', view.clientId], ['redirect_uri', view.redirectUri], ['challenge', view.challenge], ['state', view.state]]
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`).join('')
  const scopes = view.offered.map(scope => {
    const info = SCOPE_INFO[scope]
    return `<label class="scope"><input type="checkbox" name="scope" value="${scope}"${view.checked.includes(scope) ? ' checked' : ''}><span class="box">${CHECK}</span><span><strong>${escapeHtml(info.label)}${info.sensitive ? '<span class="tag">Sensitive</span>' : ''}</strong><small>${escapeHtml(info.description)}</small></span></label>`
  }).join('')
  const modes = MODES.map(mode =>
    `<label class="mode"><input type="radio" name="mode" value="${mode.id}"${mode.id === view.mode ? ' checked' : ''}><span><strong>${mode.title}</strong><small>${escapeHtml(mode.description)}</small></span></label>`
  ).join('')
  return renderPage('Connect an app', `
<div class="head">
  <div class="app"><div class="avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div><div><h1>${escapeHtml(name)} wants to use Muse</h1><small>Returns to ${escapeHtml(hostOf(view.redirectUri))}</small></div></div>
  <p>Choose what this app can do. You can change or revoke access any time in Muse → Settings → Connected apps.</p>
</div>
<form class="body" method="post" action="/oauth/authorize">
  ${hidden}
  ${view.error ? `<div class="alert" role="alert">${escapeHtml(view.error)}</div>` : ''}
  <fieldset><legend>Access</legend><div class="scopes">${scopes}</div></fieldset>
  <fieldset><legend>When it wants to delete something</legend><div class="modes">${modes}</div></fieldset>
  <label class="remember"><input type="checkbox" name="remember" value="yes"${view.remembered ? ' checked' : ''}> Remember this app on this server</label>
  <div class="field"><label class="label" for="passphrase">Muse passphrase</label><input id="passphrase" type="password" name="passphrase" required autocomplete="current-password" placeholder="Confirm it's you"></div>
  <div class="actions"><a class="btn" href="${escapeHtml(view.denyUrl)}">Cancel</a><button class="btn primary" type="submit">Allow access</button></div>
</form>`, `Only allow apps you trust. ${name} will act as you inside Muse.`)
}

export interface ApproveView {
  id: string
  csrf: string
  tool: string
  target: string
  summary: string
  clientName?: string
  error?: string
}

export function approvePage(view: ApproveView): string {
  return renderPage('Approve this action', `
<div class="head">
  <div class="icon bad"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></div>
  <h1>Approve a deletion?</h1>
  <p>${view.clientName ? `${escapeHtml(view.clientName)} asked` : 'A connected app asked'} to run an action that needs your approval (Standard mode).</p>
</div>
<form class="body" method="post" action="/approve/${escapeHtml(view.id)}">
  <input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
  ${view.error ? `<div class="alert" role="alert">${escapeHtml(view.error)}</div>` : ''}
  <dl class="details"><dt>Action</dt><dd><code>${escapeHtml(view.tool)}</code></dd><dt>Target</dt><dd>${escapeHtml(view.target)}</dd>${view.summary ? `<dt>Details</dt><dd>${escapeHtml(view.summary)}</dd>` : ''}</dl>
  <div class="field"><label class="label" for="passphrase">Muse passphrase</label><input id="passphrase" type="password" name="passphrase" required autocomplete="current-password" placeholder="Confirm it's you"></div>
  <div class="actions"><button class="btn" name="decision" value="deny">Deny</button><button class="btn danger" name="decision" value="approve">Approve</button></div>
</form>`)
}

export function messagePage(kind: 'ok' | 'error' | 'info', title: string, message: string): string {
  const icon = kind === 'ok'
    ? `<div class="icon ok">${CHECK.replace(/width="14" height="14"/, 'width="24" height="24"')}</div>`
    : kind === 'error'
      ? '<div class="icon bad"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M12 7v6M12 17h.01"/></svg></div>'
      : `<div class="icon">${LOGO}</div>`
  return renderPage(title, `<div class="head" style="border:0;text-align:center;display:grid;justify-items:center;padding-bottom:28px">${icon}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`)
}
