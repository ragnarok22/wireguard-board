// @vitest-environment node
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
let directory: string | undefined
afterEach(async () => {
  vi.unstubAllEnvs()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})

it('runs the independently emitted Vercel function using root compiler settings', async () => {
  vi.stubEnv('VERCEL', '0')
  const config = ts.readConfigFile(
    resolve(root, 'tsconfig.json'),
    ts.sys.readFile,
  )
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const parent = resolve(root, 'node_modules/.tmp')
  await mkdir(parent, { recursive: true })
  directory = await mkdtemp(resolve(parent, 'vercel-runtime-'))
  await mkdir(resolve(directory, 'api'))
  await mkdir(resolve(directory, 'server'))
  await writeFile(resolve(directory, 'package.json'), '{"type":"module"}')
  await symlink(
    resolve(root, 'node_modules'),
    resolve(directory, 'node_modules'),
    'dir',
  )
  const files = [
    'api/wireguard.ts',
    ...(await readdir(resolve(root, 'server')))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => `server/${file}`),
  ]
  for (const file of files) {
    const source = await readFile(resolve(root, file), 'utf8')
    const output = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { ...parsed.options, module: ts.ModuleKind.ESNext },
    }).outputText
    await writeFile(resolve(directory, file.replace(/\.ts$/, '.js')), output)
  }
  // Vercel emits individual JS files, not the Vite test runner's TS modules.
  // Importing this tree catches retained .ts specifiers and runtime loader errors.
  const module = await import(
    pathToFileURL(resolve(directory, 'api/wireguard.js')).href
  )
  const response = (await module.default.fetch(
    new Request('https://board.example.com/api/wireguard?path=/livez', {
      headers: { 'X-WireGuard-Server': 'http://127.0.0.1' },
    }),
  )) as Response
  expect(response.status).toBe(400)
  expect((await response.json()).code).toBe('proxy_private_target')
  expect(parsed.options.types).toContain('node')
})
