// Notifications: push via the admin backend / webhook. Never includes keys.
// Production posts to NOTIFY_WEBHOOK_URL (Cloudflare secret) and records the
// event in D1 keeper_runs + the mobile push queue.
export interface NotifyEnv { NOTIFY_WEBHOOK_URL?: string }
export async function notify(env: NotifyEnv, event: string, detail: Record<string, unknown>): Promise<void> {
  const payload = { event, ...detail, at: new Date().toISOString() }
  if (!env.NOTIFY_WEBHOOK_URL) { console.log('[notify: no webhook configured]', JSON.stringify(payload)); return }
  try {
    await fetch(env.NOTIFY_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  } catch (err) { console.error('[notify failed]', err) }
}
