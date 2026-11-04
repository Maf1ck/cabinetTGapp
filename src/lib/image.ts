// Фото з камери телефону важать 3–8 МБ: перед завантаженням зменшуємо до розумного розміру.
const MAX_SIDE = 1600
const QUALITY = 0.82
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (blob && blob.size < file.size) return blob
  } catch {
    // формат, який браузер не вміє розібрати (напр. HEIC на ПК): вантажимо як є
  }
  return file
}
