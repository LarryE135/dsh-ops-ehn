/**
 * How the release gate starts each step, decided without a shell wherever possible.
 *
 * `spawn(command, args, { shell: true })` only joins `args` with spaces and hands the line to
 * `cmd.exe`: a temporary directory under `C:\Users\John Doe\...` splits into two arguments, and
 * Node 24 warns about the pattern (DEP0190). Only `npm` ever needed the shell on Windows, because it
 * is `npm.cmd` there; it runs as `node <npm-cli.js>` instead. `node` is this very interpreter.
 * Everything else (`cargo`, `tar`) is an `.exe` that `spawn` resolves on its own.
 *
 * @module dsh-ops/scripts/lib/gate-spawn
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Quote one argument for a `cmd.exe` command line. Only the last-resort npm path uses it; an
 * argument `cmd.exe` cannot carry literally is refused rather than passed on altered.
 * @param {string} arg - the argument.
 * @returns {string} the argument as `cmd.exe` reads it back.
 */
export function quoteForCmd(arg) {
  if (/["%!^&|<>\r\n]/.test(arg)) throw new Error(`cannot pass ${JSON.stringify(arg)} through cmd.exe unaltered`)
  return arg === '' || /\s/.test(arg) ? `"${arg}"` : arg
}

/**
 * The npm CLI script for this Node installation, if one can be found: the one `npm run` exported
 * as `npm_execpath`, else the one bundled next to `node.exe`.
 * @param {object} host - where to look.
 * @returns {string | undefined} the absolute `npm-cli.js` path.
 */
function npmCli({ env, execPath, exists, pathApi }) {
  const candidates = [env.npm_execpath, pathApi.join(pathApi.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  return candidates.find(file => typeof file === 'string' && /npm-cli\.[cm]?js$/i.test(file) && exists(file))
}

/**
 * The `spawn` call for one gate step.
 * @param {string} command - `node`, `npm`, `cargo`, `tar`, ...
 * @param {string[]} args - the arguments, each delivered as exactly one argv entry.
 * @param {object} [host] - the host to plan for; defaults to this process.
 * @returns {{ file: string, args: string[], shell: boolean }} what to pass to `spawn`.
 */
export function spawnPlan(command, args, {
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  exists = existsSync,
} = {}) {
  if (command === 'node') return { file: execPath, args: [...args], shell: false }
  if (platform !== 'win32' || command !== 'npm') return { file: command, args: [...args], shell: false }
  const cli = npmCli({ env, execPath, exists, pathApi: path.win32 })
  if (cli !== undefined) return { file: execPath, args: [cli, ...args], shell: false }
  // No npm-cli.js beside this Node: fall back to `npm.cmd` through cmd.exe, as one quoted line,
  // never as an args array the shell would re-split.
  return { file: ['npm', ...args].map(quoteForCmd).join(' '), args: [], shell: true }
}
