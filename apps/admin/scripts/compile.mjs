// Stelix Admin — real compile of StelixVault with pinned solc 0.8.24 (solc-js).
// Run: `npm run compile:contract` (from apps/admin).
// Reads src/contracts/StelixVault.sol + src/contracts/interfaces/*.sol (exact
// mirrors of contracts/src/), compiles with solc 0.8.24, optimizer on,
// 200 runs, via_ir — the same settings as contracts/foundry.toml — and writes
// src/contracts/StelixVault.artifact.json with the ABI, bytecode hash, contract
// size and a SHA-256 hash of every source file. The Contract Studio compile
// endpoint (POST /api/admin/compile) compares the editor source against this
// artifact: a deploy/register is only accepted when the source hash matches
// the artifact that was actually compiled, so the deployed bytecode always
// corresponds to the reviewed source. No secrets, no network, no deploy.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOLC_PINNED = '0.8.24'

const files = {
  'StelixVault.sol': readFileSync(join(root, 'src/contracts/StelixVault.sol'), 'utf8'),
  'interfaces/IERC20.sol': readFileSync(join(root, 'src/contracts/interfaces/IERC20.sol'), 'utf8'),
  'interfaces/IDexRouter.sol': readFileSync(join(root, 'src/contracts/interfaces/IDexRouter.sol'), 'utf8'),
  'interfaces/IPriceFeed.sol': readFileSync(join(root, 'src/contracts/interfaces/IPriceFeed.sol'), 'utf8'),
}

const sourceHashes = Object.fromEntries(
  Object.entries(files).map(([name, content]) => [
    name,
    createHash('sha256').update(content).digest('hex'),
  ]),
)

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, { content }]),
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors ?? []).filter((e) => e.severity === 'error')
const warnings = (output.errors ?? []).filter((e) => e.severity === 'warning')
if (errors.length > 0) {
  for (const e of errors) console.error(e.formattedMessage ?? e.message)
  process.exit(1)
}
const contract = output.contracts['StelixVault.sol'].StelixVault
const bytecode = contract.evm.bytecode.object
const deployed = contract.evm.deployedBytecode.object
const artifact = {
  contract: 'StelixVault',
  compiler: `solc ${SOLC_PINNED}`,
  solcVersion: solc.version(),
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  sourceHashes,
  combinedSourceHash: createHash('sha256')
    .update(Object.values(files).join('\n'))
    .digest('hex'),
  abi: contract.abi,
  // The creation bytecode itself (hex, with 0x prefix) — needed by the
  // admin's Deploy Vault card, which deploys with the connected wallet
  // in the browser. Previously only the hash/size were stored, so the
  // vault could only be deployed with Foundry. The hash fields above
  // are unchanged, so source verification still works exactly as before.
  bytecode: `0x${bytecode}`,
  deployedBytecode: `0x${deployed}`,
  bytecodeHash: createHash('sha256').update(bytecode).digest('hex'),
  deployedBytecodeHash: createHash('sha256').update(deployed).digest('hex'),
  bytecodeBytes: bytecode.length / 2,
  deployedBytes: deployed.length / 2,
  sizeLimitBytes: 24576,
  withinSizeLimit: deployed.length / 2 <= 24576,
  warnings: warnings.map((w) => w.formattedMessage ?? w.message),
  compiledAt: new Date().toISOString(),
}
writeFileSync(
  join(root, 'src/contracts/StelixVault.artifact.json'),
  JSON.stringify(artifact, null, 2) + '\n',
)
console.log(`solc ${SOLC_PINNED}: StelixVault compiled OK`)
console.log(`  deployed size: ${artifact.deployedBytes} bytes (limit 24576)`)
console.log(`  bytecode sha256: ${artifact.bytecodeHash}`)
console.log(`  warnings: ${warnings.length}`)
for (const w of artifact.warnings) console.log(`  warning: ${w.split('\n')[0]}`)

// ---- Launchpad (StelixTokenFactory + StelixLaunchpad) ----
// Same pinned solc + settings as the vault. The factory creates the
// token (name/symbol/supply/decimals/logoURI, gas only, no Stelix fee)
// and the launchpad runs the fixed-price sale. Both are deployed from
// the admin with the connected wallet (Launchpad Manager), so their
// ABIs + creation bytecodes live in launchpad.artifact.json.
const launchpadFiles = {
  'launchpad/StelixTokenFactory.sol': readFileSync(join(root, 'src/contracts/launchpad/StelixTokenFactory.sol'), 'utf8'),
  'launchpad/LaunchToken.sol': readFileSync(join(root, 'src/contracts/launchpad/LaunchToken.sol'), 'utf8'),
  'launchpad/StelixLaunchpad.sol': readFileSync(join(root, 'src/contracts/launchpad/StelixLaunchpad.sol'), 'utf8'),
  'interfaces/IERC20.sol': readFileSync(join(root, 'src/contracts/interfaces/IERC20.sol'), 'utf8'),
}
const launchpadSourceHashes = Object.fromEntries(
  Object.entries(launchpadFiles).map(([name, content]) => [
    name,
    createHash('sha256').update(content).digest('hex'),
  ]),
)
const launchpadInput = {
  language: 'Solidity',
  sources: Object.fromEntries(
    Object.entries(launchpadFiles).map(([name, content]) => [name, { content }]),
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}
const launchpadOutput = JSON.parse(solc.compile(JSON.stringify(launchpadInput)))
const launchpadErrors = (launchpadOutput.errors ?? []).filter((e) => e.severity === 'error')
const launchpadWarnings = (launchpadOutput.errors ?? []).filter((e) => e.severity === 'warning')
if (launchpadErrors.length > 0) {
  for (const e of launchpadErrors) console.error(e.formattedMessage ?? e.message)
  process.exit(1)
}
const oneArtifact = (contractName, fileKey) => {
  const c = launchpadOutput.contracts[fileKey][contractName]
  const bc = c.evm.bytecode.object
  const dep = c.evm.deployedBytecode.object
  return {
    abi: c.abi,
    bytecode: `0x${bc}`,
    deployedBytecode: `0x${dep}`,
    bytecodeHash: createHash('sha256').update(bc).digest('hex'),
    deployedBytecodeHash: createHash('sha256').update(dep).digest('hex'),
    bytecodeBytes: bc.length / 2,
    deployedBytes: dep.length / 2,
    sizeLimitBytes: 24576,
    withinSizeLimit: dep.length / 2 <= 24576,
  }
}
const launchpadArtifact = {
  compiler: `solc ${SOLC_PINNED}`,
  solcVersion: solc.version(),
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  sourceHashes: launchpadSourceHashes,
  factory: oneArtifact('StelixTokenFactory', 'launchpad/StelixTokenFactory.sol'),
  launchpad: oneArtifact('StelixLaunchpad', 'launchpad/StelixLaunchpad.sol'),
  warnings: launchpadWarnings.map((w) => w.formattedMessage ?? w.message),
  compiledAt: new Date().toISOString(),
}
writeFileSync(
  join(root, 'src/contracts/launchpad.artifact.json'),
  JSON.stringify(launchpadArtifact, null, 2) + '\n',
)
console.log(`solc ${SOLC_PINNED}: StelixTokenFactory + StelixLaunchpad compiled OK`)
console.log(`  factory deployed size: ${launchpadArtifact.factory.deployedBytes} bytes (limit 24576)`)
console.log(`  launchpad deployed size: ${launchpadArtifact.launchpad.deployedBytes} bytes (limit 24576)`)
console.log(`  factory bytecode sha256: ${launchpadArtifact.factory.bytecodeHash}`)
console.log(`  launchpad bytecode sha256: ${launchpadArtifact.launchpad.bytecodeHash}`)
console.log(`  warnings: ${launchpadWarnings.length}`)
for (const w of launchpadArtifact.warnings) console.log(`  warning: ${w.split('\n')[0]}`)
