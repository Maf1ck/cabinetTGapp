import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let accessToken: string | null = null
let client: SupabaseClient | null = null

/** Токен від /api/auth/*: з ним RLS бачить auth.uid() = users.id. */
export const setAccessToken = (token: string | null) => {
  accessToken = token
}

// Створюємо ліниво: без VITE_SUPABASE_URL (тести, перший запуск) застосунок не падає на старті
export function supabase(): SupabaseClient {
  client ??= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    accessToken: async () => accessToken,
  })
  return client
}
