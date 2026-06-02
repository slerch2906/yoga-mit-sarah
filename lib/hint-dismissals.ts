'use client'

/**
 * Sarah 2026-06-02: EINE zentrale Wegklick-Persistenz fuer ALLE Admin-/Yogi-
 * Hinweise. Statt jeden Banner einzeln (localStorage -> kam nach Logout wieder),
 * merkt sich dieser Hook das Wegklicken pro Nutzer in der DB-Tabelle
 * `user_dismissals(key)`. Dadurch: logout-fest UND geraeteuebergreifend.
 * localStorage dient nur noch als Flacker-Cache.
 *
 * Verwendung in einer Client-Komponente:
 *   const { isDismissed, dismiss, ready } = useHintDismissals()
 *   if (ready && !isDismissed('mein_hinweis')) {
 *     <button onClick={() => dismiss('mein_hinweis')}>x</button>
 *   }
 *
 * Key-Konvention (frei waehlbar, aber sprechend + ggf. mit ID/Woche):
 *   'new_yogi'                       – einmaliger Hinweis pro Yogi
 *   'birthday:2026-06-01'            – pro Kalenderwoche (Montag)
 *   'credit_expiry:<reminder-id>'    – pro konkretem Hinweis/Credit
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const LS_PREFIX = 'hint_dismiss:'

export function useHintDismissals() {
  const [keys, setKeys] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    ;(async () => {
      // 1) localStorage-Cache (verhindert Flackern bis die DB antwortet)
      try {
        const cached = Object.keys(localStorage)
          .filter(k => k.startsWith(LS_PREFIX))
          .map(k => k.slice(LS_PREFIX.length))
        if (cached.length && active) setKeys(new Set(cached))
      } catch {}
      // 2) DB ist die Wahrheit
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data } = await supabase
            .from('user_dismissals').select('key').eq('user_id', user.id)
          if (active && data) {
            const s = new Set<string>(data.map((r: any) => r.key))
            setKeys(s)
            try { for (const k of s) localStorage.setItem(LS_PREFIX + k, '1') } catch {}
          }
        }
      } catch {}
      if (active) setReady(true)
    })()
    return () => { active = false }
  }, [])

  const isDismissed = useCallback((key: string) => keys.has(key), [keys])

  const dismiss = useCallback(async (key: string) => {
    setKeys(prev => { const n = new Set(prev); n.add(key); return n })
    try { localStorage.setItem(LS_PREFIX + key, '1') } catch {}
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('user_dismissals')
          .upsert({ user_id: user.id, key }, { onConflict: 'user_id,key', ignoreDuplicates: true })
      }
    } catch {}
  }, [])

  return { isDismissed, dismiss, ready, dismissedKeys: keys }
}
