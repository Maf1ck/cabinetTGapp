// Повідомити сервер про подію, щоб бот написав у Telegram (api/notify.ts).
// Тихо: якщо сповіщення не пішло, дія в кабінеті все одно вдалася.
import { supabase } from '@/lib/supabase'

export type NotifyEvent = 'menu_published' | 'diary_comment' | 'diary_entry' | 'appointment' | 'lab_file'

export function notify(event: NotifyEvent, id: string): void {
  void (async () => {
    try {
      const { data } = await supabase().auth.getSession()
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ event, id }),
        keepalive: true,
      })
    } catch {
      // не критично
    }
  })()
}
