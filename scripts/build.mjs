import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'

const watch = process.argv.includes('--watch')
mkdirSync(new URL('../dist', import.meta.url), { recursive: true })

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
  target: ['es2018'],
  logLevel: 'info',
}

async function main() {
  const ctxEsm = await esbuild.context({
    ...shared,
    outfile: 'dist/ivva-crx-sdk.js',
    format: 'esm',
  })
  const ctxUmd = await esbuild.context({
    ...shared,
    outfile: 'dist/ivva-crx-sdk.umd.cjs',
    format: 'iife',
    globalName: 'IvvaCrxSdk',
  })
  if (watch) {
    await Promise.all([ctxEsm.watch(), ctxUmd.watch()])
    console.log('[ivva-crx-sdk] watching…')
  } else {
    await Promise.all([ctxEsm.rebuild(), ctxUmd.rebuild()])
    await ctxEsm.dispose()
    await ctxUmd.dispose()
    console.log('[ivva-crx-sdk] build ok → dist/')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
