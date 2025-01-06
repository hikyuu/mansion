import { useUserStore } from '@/store/user-store'

declare interface Archive {
  id?: number
  serial_number: string
  download_time: Date
}

export async function haveArchived(serialNumber: string) {
  const id = sortId(serialNumber)
  console.log(id)
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from('archive').select('id').ilike('serial_number', `%${id}%`)
  if (data && data.length > 0) {
    data.forEach((item) => {
      console.log(item)
    })
    return true
  }
  if (error) {
    console.error(error)
  }
  return false
}

export async function upsertArchive(archive: Archive) {
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from('archive').upsert(archive, { onConflict: 'serial_number' })
  if (error) {
    console.error(error)
  }
  return data
}

function sortId(serialNumber: string) {
  return serialNumber
    .replace(/\s+/g, '')
    .replace(/fc2[\s\S]?ppv[-_]?/gi, '')
    .replace(/^\d+/, '')
    .replace(/[-_]/g, '')
}
