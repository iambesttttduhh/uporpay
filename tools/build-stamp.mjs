// ---------------------------------------------------------------------------
// build-stamp.mjs — "which commit is this bundle?"
//
// tools/build-www.mjs writes the answer into www/native.json, which is the only
// way an installed APK knows its own provenance: Settings → Data prints it, and
// versionName in the manifest is derived from the same CI variables. It is a
// separate module because www/ is a build product and deliberately not committed,
// so the stamp has to be checkable without running a full staging pass.
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process'

const HEX = /^[0-9a-f]{7,40}$/

export function gitInfo(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // No git, a detached checkout, a container without the binary: the caller gets
    // an empty string and decides what "unknown" looks like. Never throw here —
    // stamping a bundle is not worth failing a build over.
    return ''
  }
}

export function buildStamp({ root, env = process.env, builtAt = new Date().toISOString() } = {}) {
  const sha = env.GITHUB_SHA || gitInfo(root, ['rev-parse', 'HEAD'])
  const rev = String(sha).slice(0, 7)
  const described = gitInfo(root, ['describe', '--tags', '--always'])
  return {
    native: true,
    builtAt,
    rev: HEX.test(rev) ? rev : 'unknown',
    described: HEX.test(described) ? described : rev || 'unknown',
  }
}
