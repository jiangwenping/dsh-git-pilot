import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-git-pilot'

const host = defineConfig({
  name: PLUGIN_ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  sourcemap: false,
  clean: true,
  deps: { neverBundle: true },
})

const client = defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  sourcemap: false,
  clean: false,
  deps: {
    // React and host packages resolve from the platform module table, so the
    // browser module loader shares the shell's own bundled copies (styles and
    // all) instead of a second, unstyled instance inside this bundle.
    neverBundle: [/^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/, /^@deepseek-ai\//],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

export default [host, client]
