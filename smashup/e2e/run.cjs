/* End-to-end check in headless Chromium (needs `playwright` resolvable, e.g. `npm i -D playwright`).
 *
 *   node e2e/run.cjs
 *
 * 1. Synth demo crate → Word Wall fills → pads assigned → arrangement composes
 * 2. Play, edit a seam, undo, export WAV (non-silent, expected length)
 * 3. Upload path: a rendered song + `.words.json` sidecar into a fresh crate
 * Screenshots land in e2e/out/.
 */
const path = require('node:path')
const fs = require('node:fs')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, 'out')
const FIX = path.join(__dirname, 'fixtures')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(FIX, { recursive: true })
  const { createServer } = await import('vite')
  const server = await createServer({ root: ROOT, server: { port: 5199, strictPort: true }, logLevel: 'error' })
  await server.listen()
  const url = 'http://localhost:5199/'
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    // The analysis service isn't running here; its 502/404s are expected (on-device mode).
    if (m.type() === 'error' && !/50[0-9]|404|Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  const state = (fn) => page.evaluate(fn)
  const waitState = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout })

  try {
    await page.goto(url)
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('smashup'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
    await page.reload()
    await page.waitForSelector('text=Crates')

    console.log('1. Synth demo crate')
    const t0 = Date.now()
    await page.getByRole('button', { name: 'Synth demo' }).click()
    await waitState(() => {
      const s = window.__smashup.getState()
      const c = s.crates.find((x) => x.id === s.activeId)
      return c && c.songs.length === 5 && c.songs.every((x) => x.status === 'ready') && s.timeline
    })
    console.log(`  analysed + composed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    const songs = await state(() => {
      const s = window.__smashup.getState()
      return s.crates.find((x) => x.id === s.activeId).songs.map((x) => ({ bpm: x.analysis.bpm, hits: x.hits.length, pads: x.pads.filter((p) => p.momentId).length }))
    })
    const truth = [96, 92, 100, 128, 98]
    songs.forEach((s, i) => assert(Math.abs(s.bpm - truth[i]) / truth[i] < 0.02, `song ${i + 1} tempo ${s.bpm} ≈ ${truth[i]}`))
    assert(songs.every((s) => s.hits >= 8), 'every song has keyword hits')
    assert(songs.every((s) => s.pads === 4), 'every song has 4 pads')
    await page.waitForTimeout(800)
    assert((await page.getByTestId('hit-card').count()) >= 40, 'Word Wall shows the hits')
    await page.screenshot({ path: path.join(OUT, '1-word-wall.png') })

    console.log('2. Pads')
    await page.getByTestId('mode-perform').click()
    assert((await page.locator('[data-testid=pad-grid] tbody tr').count()) === 5, 'pad grid has a row per song')
    await page.screenshot({ path: path.join(OUT, '2-pads.png') })
    await page.getByRole('button', { name: 'Go live' }).click()
    await page.getByText('Live · quantized').waitFor({ timeout: 60000 })
    await page.keyboard.press('1')
    await page.waitForTimeout(3000)
    await page.keyboard.press('e')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT, '3-pads-live.png') })
    await page.getByText('Live · quantized').click()

    console.log('3. Arrangement')
    await page.getByTestId('mode-produce').click()
    await page.waitForTimeout(4000)
    const plan = await state(() => {
      const s = window.__smashup.getState()
      const byMoment = new Map(s.crates.find((x) => x.id === s.activeId).songs.flatMap((so) => so.moments.map((m) => [m.id, so.id])))
      return { n: s.plan.sections.length, songs: new Set(s.plan.sections.map((x) => byMoment.get(x.momentId))).size, plans: s.plans.length, seams: s.plan.seams.map((x) => x.move), dur: s.timeline.duration }
    })
    assert(plan.n >= 6, `plan has ${plan.n} sections`)
    assert(plan.songs === 5, 'plan uses all 5 songs')
    assert(plan.plans >= 2, `${plan.plans} alternative plans`)
    assert(plan.seams.every((m, i) => i === 0 || m !== plan.seams[i - 1]), `no repeated move back to back (${plan.seams.join(', ')})`)
    await page.screenshot({ path: path.join(OUT, '4-arrangement.png') })

    await page.getByTestId('play').click()
    await waitState(() => window.__smashup.getState().playing, 60000)
    await page.waitForTimeout(2500)
    const pos = await state(() => window.__smashup.getState().position)
    assert(pos > 1.5, `playback advances (${pos.toFixed(2)}s)`)
    await page.getByTestId('play').click()

    await page.getByTestId('seam').first().click()
    await page.getByTestId('seam-inspector').getByRole('button', { name: /Drop-out/ }).click()
    assert((await state(() => window.__smashup.getState().plan.seams[0].move)) === 'dropOut', 'seam edit applies')
    await page.screenshot({ path: path.join(OUT, '5-seam-editor.png') })
    await page.getByRole('button', { name: 'Undo' }).click()
    assert((await state(() => window.__smashup.getState().plan.seams[0].move)) === plan.seams[0], 'undo restores the move')

    await page.getByTestId('section').nth(1).click()
    await page.getByTestId('section-inspector').getByRole('button', { name: /^Lock/ }).click()
    await page.getByRole('button', { name: 'Re-roll' }).click()
    const locked = await state(() => window.__smashup.getState().plan.sections[1].locked)
    assert(locked === true, 're-roll keeps the locked section')

    console.log('4. Export')
    const exp = await page.evaluate(async () => {
      const s = window.__smashup.getState()
      const blob = await window.__smashupSession.exportWav(s.timeline, s.master)
      const buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await blob.arrayBuffer())
      const d = buf.getChannelData(0)
      let e = 0
      for (let i = 0; i < d.length; i += 3) e += d[i] * d[i]
      return { dur: buf.duration, tl: s.timeline.duration, rms: Math.sqrt(e / (d.length / 3)) }
    })
    assert(Math.abs(exp.dur - (exp.tl + 2.5)) < 0.1, `export length ${exp.dur.toFixed(1)}s matches timeline + tail`)
    assert(exp.rms > 0.02, `export is not silent (rms ${exp.rms.toFixed(3)})`)
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByTestId('export').click()])
    assert(download.suggestedFilename().endsWith('.wav'), `WAV button downloads ${download.suggestedFilename()}`)

    console.log('5. Upload + sidecar')
    const fx = await page.evaluate(async () => {
      const { renderDemoSource, DEMO_SONGS } = await import('/src/demo/index.ts')
      const src = await renderDemoSource(DEMO_SONGS[2], 2)
      const b = new Uint8Array(await src.blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return { wav: btoa(bin), words: JSON.stringify({ words: src.sidecarWords }) }
    })
    fs.writeFileSync(path.join(FIX, 'test-paisa.wav'), Buffer.from(fx.wav, 'base64'))
    fs.writeFileSync(path.join(FIX, 'test-paisa.words.json'), fx.words)
    await page.getByRole('button', { name: 'New crate' }).click()
    await page.getByPlaceholder('Crate name (e.g. Paisa)').fill('Upload test')
    await page.getByPlaceholder('Keyword (e.g. paisa)').fill('paisa')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByTestId('file-input').setInputFiles([path.join(FIX, 'test-paisa.wav'), path.join(FIX, 'test-paisa.words.json')])
    await waitState(() => {
      const s = window.__smashup.getState()
      const c = s.crates.find((x) => x.id === s.activeId)
      return c?.name === 'Upload test' && c.songs[0]?.status === 'ready'
    })
    const up = await state(() => {
      const s = window.__smashup.getState()
      const so = s.crates.find((x) => x.id === s.activeId).songs[0]
      return { hits: so.hits.length, source: so.wordsSource, bpm: so.analysis.bpm }
    })
    assert(up.source === 'sidecar' && up.hits >= 8, `uploaded song found ${up.hits} hits from its sidecar`)
    await page.getByTestId('mode-discover').click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT, '6-upload.png') })

    assert(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
    console.log('\nE2E PASSED')
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {})
    console.error('\nE2E FAILED:', e.message, errors.length ? `\npage errors: ${errors.join(' | ')}` : '')
    process.exitCode = 1
  } finally {
    await browser.close()
    await server.close()
  }
})()
