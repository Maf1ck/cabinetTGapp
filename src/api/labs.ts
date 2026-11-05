// Аналізи клієнта: файли в приватному бакеті labs (<client_id>/<файл>) + рядки lab_files.
// Клієнт керує своїми, нутриціолог бачить усі (RLS і Storage-політика з 0001).
import { supabase } from '@/lib/supabase'
import { must } from './client'
import { notify } from './notify'

export interface LabFile {
  id: string
  title: string
  file_path: string
  uploaded_at: string
  url: string | null
}

export const LAB_MAX_MB = 15
// те саме, що дозволяє бакет labs (міграція 0006)
export const LAB_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const LAB_ACCEPT = `.pdf,.heic,${LAB_TYPES.join(',')}`

export async function listLabs(clientId: string): Promise<LabFile[]> {
  const rows = must(
    await supabase()
      .from('lab_files')
      .select('id, title, file_path, uploaded_at')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: false }),
  ) as Omit<LabFile, 'url'>[]
  const urls = new Map<string, string>()
  if (rows.length) {
    const { data } = await supabase()
      .storage.from('labs')
      .createSignedUrls(
        rows.map((r) => r.file_path),
        3600,
      )
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  return rows.map((r) => ({ ...r, url: urls.get(r.file_path) ?? null }))
}

const extOf = (name: string) => name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? 'bin'

export async function uploadLab(clientId: string, file: File, title: string): Promise<LabFile> {
  if (file.size > LAB_MAX_MB * 1024 * 1024) throw new Error('too_big')
  if (!LAB_TYPES.includes(file.type) && !/\.heic$/i.test(file.name)) throw new Error('bad_type')
  const file_path = `${clientId}/${crypto.randomUUID()}.${extOf(file.name)}`
  const { error } = await supabase()
    .storage.from('labs')
    .upload(file_path, file, { contentType: file.type || 'image/heic' })
  if (error) throw error
  const { data, error: insertError } = await supabase()
    .from('lab_files')
    .insert({ client_id: clientId, title, file_path })
    .select('id, title, file_path, uploaded_at')
    .single()
  if (insertError) {
    await supabase().storage.from('labs').remove([file_path])
    throw insertError
  }
  notify('lab_file', data.id)
  const { data: signed } = await supabase().storage.from('labs').createSignedUrl(file_path, 3600)
  return { ...(data as Omit<LabFile, 'url'>), url: signed?.signedUrl ?? null }
}

export async function deleteLab(file: Pick<LabFile, 'id' | 'file_path'>): Promise<void> {
  must(await supabase().from('lab_files').delete().eq('id', file.id))
  await supabase().storage.from('labs').remove([file.file_path])
}
