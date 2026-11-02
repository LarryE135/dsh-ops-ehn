import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT, assert, report, test, withTempDir } from './lib/harness.mjs'
import { quoteForCmd, spawnPlan } from '../scripts/lib/gate-spawn.mjs'

const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
const PACK = 'C:\\Users\\John Doe\\AppData\\Local\\Temp\\dsh-ops-pack-abc'
const win32 = (extra = {}) => ({ platform: 'win32', execPath: NODE, env: {}, exists: () => false, ...extra })

await test('Windows npm runs as node <npm-cli.js> without a shell, so a spaced path stays one argument', () => {
  const plan = spawnPlan('npm', ['pack', '--pack-destination', PACK], win32({ env: { npm_execpath: CLI }, exists: file => file === CLI }))
  assert.deepEqual(plan, { file: NODE, args: [CLI, 'pack', '--pack-destination', PACK], shell: false })
})

await test('Windows npm finds the npm CLI bundled beside node.exe when npm_execpath is absent', () => {
  const plan = spawnPlan('npm', ['run', 'build'], win32({ exists: file => file === CLI }))
  assert.deepEqual(plan, { file: NODE, args: [CLI, 'run', 'build'], shell: false })
})

await test('Windows npm without a resolvable CLI goes through cmd.exe as one quoted line, never a re-split args array', () => {
  const plan = spawnPlan('npm', ['pack', '--pack-destination', PACK], win32())
  assert.deepEqual(plan, { file: `npm pack --pack-destination "${PACK}"`, args: [], shell: true })
  assert.throws(() => quoteForCmd('a"b'), /cmd\.exe/)
  assert.throws(() => quoteForCmd('%TEMP%'), /cmd\.exe/)
})

await test('node, cargo and tar never go through a shell on Windows; node is this interpreter', () => {
  const root = `${PACK}\\package`
  assert.deepEqual(spawnPlan('node', ['bin/native-runtime.mjs', 'check', '--root', root], win32()),
    { file: NODE, args: ['bin/native-runtime.mjs', 'check', '--root', root], shell: false })
  assert.deepEqual(spawnPlan('cargo', ['--version'], win32()), { file: 'cargo', args: ['--version'], shell: false })
  assert.deepEqual(spawnPlan('tar', ['-xzf', 'a b.tgz'], win32()), { file: 'tar', args: ['-xzf', 'a b.tgz'], shell: false })
})

await test('a planned node step delivers a spaced argument as exactly one argv entry on this host', () => {
  const plan = spawnPlan('node', ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'C:\\tmp\\a b', 'x'])
  const result = spawnSync(plan.file, plan.args, { shell: plan.shell, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ['C:\\tmp\\a b', 'x'])
})

// The gate itself, with stub npm/cargo on PATH and a temp directory containing a space. The stubs
// are POSIX shell scripts; on Windows the planned npm is the real npm-cli.js, so there is no stub
// seam and this check does not run there (it is not counted as a pass).
if (process.platform !== 'win32') {
  await test('the gate reports an empty npm pack as a named failure instead of a ReferenceError', async () => {
    await withTempDir('gate-spawn', async dir => {
      const bin = path.join(dir, 'bin')
      const tmp = path.join(dir, 'tmp with space')
      mkdirSync(bin)
      mkdirSync(tmp)
      const log = path.join(dir, 'npm-pack.log')
      const suites = readdirSync(path.join(PACKAGE_ROOT, 'test')).filter(name => name.endsWith('.test.mjs')).length
      writeFileSync(path.join(bin, 'npm'), [
        '#!/bin/sh',
        'case "$1 $2" in',
        '  "run validate:manifest") echo "validate-manifest: all 99 checks passed" ;;',
        `  "run verify") echo "dsh-ops test: ${suites} suite(s) passed in 0s" ;;`,
        `  pack*) printf '%s\\n' "$#" "$3" > '${log}' ;;`,
        'esac',
        'exit 0',
        '',
      ].join('\n'))
      writeFileSync(path.join(bin, 'cargo'), '#!/bin/sh\necho "cargo 0.0.0 (stub)"\n')
      chmodSync(path.join(bin, 'npm'), 0o755)
      chmodSync(path.join(bin, 'cargo'), 0o755)
      const result = spawnSync(process.execPath, ['scripts/verify-gate.mjs', '--skip-install', '--keep-going'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TMPDIR: tmp },
      })
      const output = `${result.stdout}${result.stderr}`
      assert.equal(result.status, 1, output)
      assert.doesNotMatch(output, /before initialization/)
      assert.match(output, /FAIL npm pack produced no \.tgz in the pack destination/)
      const [argc, destination] = readFileSync(log, 'utf8').split('\n')
      assert.equal(argc, '3', 'npm pack receives exactly three arguments')
      assert.ok(destination.startsWith(path.join(tmp, 'dsh-ops-pack-')), destination)
    })
  })
} else {
  console.log('  gate stub fixture unavailable: the stub npm/cargo are POSIX shell scripts and Windows npm runs as npm-cli.js')
}

report('gate-spawn')
