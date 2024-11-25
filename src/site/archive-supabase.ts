import { createClient } from '@supabase/supabase-js'

declare interface Archive {
  id: number
  serial_number: string
  download_time: Date
}
export const supabase = createClient(
  'https://tlxamlurkzfqblzyfztp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRseGFtbHVya3pmcWJsenlmenRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI0NzY3NjAsImV4cCI6MjA0ODA1Mjc2MH0.WtULPMnex03muMRS1L1M52yuxNTeEAG6nB3g_C2Q-CI'
)

export async function haveArchived(serialNumber: string) {
  const id = sortId(serialNumber)
  console.log(id)
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

function sortId(serialNumber: string) {
  return serialNumber
    .replace(/\s+/g, '')
    .replace(/fc2[\s\S]?ppv[-_]?/gi, 'fc2')
    .replace(/^\d+/, '')
    .replace(/[-_]/g, '')
}
