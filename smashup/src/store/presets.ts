/** Crate templates. Audio is never bundled: slots show "drop audio" or auto-load from /preloads. */

export interface TemplateSong {
  title: string
  slug: string
  /** Search hint for LRCLib when the analysis service is offline. */
  query: string
  padLabels: [string, string, string, string]
}

export interface CrateTemplate {
  id: string
  name: string
  keyword: string
  aliases: string[]
  songs: TemplateSong[]
}

export const PAISA_TEMPLATE: CrateTemplate = {
  id: 'paisa',
  name: 'Paisa',
  keyword: 'paisa',
  aliases: ['paise', 'pesa', 'paisaa', 'पैसा', 'pėsa'],
  songs: [
    { title: 'Nusta Paisa', slug: 'nusta-paisa', query: 'Nusta Paisa', padLabels: ['Nusta Paisa', 'Pre-hook drums', 'Mera paisa', 'Instrumental'] },
    { title: 'Paisa Hai Toh', slug: 'paisa-hai-toh', query: 'Paisa Hai Toh Farzi', padLabels: ['Paisa hai toh', 'Badi badi', 'Bas paisa sach hai', 'Instrumental'] },
    { title: 'Hasan Raheem', slug: 'hasan-raheem-paisa', query: 'Hasan Raheem Paisa', padLabels: ['Paisa vocal', 'Main hook', 'Instrumental', 'Vocal ending'] },
    { title: 'De Dana Dan', slug: 'de-dana-dan', query: 'De Dana Dan title track', padLabels: ['Paisa paisa', 'Kyu paisa', 'Paisa chant', 'Dan dana dan'] },
    { title: 'Paisa Masanga', slug: 'paisa-masanga', query: 'Paisa Masanga', padLabels: ['Paisa ta sanga', 'Paisa ma sanga', 'Full hook', 'Drop'] },
  ],
}

export const TEMPLATES = [PAISA_TEMPLATE]
