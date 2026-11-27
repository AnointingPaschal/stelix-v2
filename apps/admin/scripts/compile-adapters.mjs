// Stelix Admin — compile the two Arc adapters with pinned solc 0.8.24.
// Run: `npm run compile:adapters` (from apps/admin).
// Reads src/contracts/adapters/*.sol + interfaces + vendor (exact mirrors
// of contracts/src/), compiles with the same settings as the vault
// (optimizer on, 200 runs, via IR), and writes
// src/contracts/adapters.artifact.json with ABI + bytecode for both
// contracts. The admin Deploy Adapters flow uses this artifact to deploy
// from the admin with a connected wallet — the admin never holds a
// private key, the wallet in the browser signs. No network, no deploy.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOLC_PINNED = '0.8.24'

const files = {
  'adapters/UniswapV3TwapFeed.sol': readFileSync(join(root, 'src/contracts/adapters/UniswapV3TwapFeed.sol'), 'utf8'),
  'adapters/StelixV3RouterAdapter.sol': readFileSync(join(root, 'src/contracts/adapters/StelixV3RouterAdapter.sol'), 'utf8'),
  'adapters/PancakeV2TwapFeed.sol': readFileSync(join(root, 'src/contracts/adapters/PancakeV2TwapFeed.sol'), 'utf8'),
  'interfaces/IERC20.sol': readFileSync(join(root, 'src/contracts/interfaces/IERC20.sol'), 'utf8'),
  'interfaces/IDexRouter.sol': readFileSync(join(root, 'src/contracts/interfaces/IDexRouter.sol'), 'utf8'),
  'interfaces/IPriceFeed.sol': readFileSync(join(root, 'src/contracts/interfaces/IPriceFeed.sol'), 'utf8'),
  'vendor/TickMath.sol': readFileSync(join(root, 'src/contracts/vendor/TickMath.sol'), 'utf8'),
  'vendor/FullMath.sol': readFileSync(join(root, 'src/contracts/vendor/FullMath.sol'), 'utf8'),
}

const sourceHashes = Object.fromEntries(
  Object.entries(files).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')]),
)

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }])),
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
const contracts = {}
for (const [file, name] of [['adapters/UniswapV3TwapFeed.sol', 'UniswapV3TwapFeed'], ['adapters/StelixV3RouterAdapter.sol', 'StelixV3RouterAdapter'], ['adapters/PancakeV2TwapFeed.sol', 'PancakeV2TwapFeed']]) {
  const c = output.contracts[file][name]
  const bytecode = c.evm.bytecode.object
  const deployed = c.evm.deployedBytecode.object
  contracts[name] = {
    abi: c.abi,
    bytecode: `0x${bytecode}`,
    deployedBytecode: `0x${deployed}`,
    bytecodeHash: createHash('sha256').update(bytecode).digest('hex'),
    deployedBytes: deployed.length / 2,
    withinSizeLimit: deployed.length / 2 <= 24576,
  }
}
const artifact = {
  compiler: `solc ${SOLC_PINNED}`,
  solcVersion: solc.version(),
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  sourceHashes,
  contracts,
  warnings: warnings.map((w) => w.formattedMessage ?? w.message),
  compiledAt: new Date().toISOString(),
}
writeFileSync(join(root, 'src/contracts/adapters.artifact.json'), JSON.stringify(artifact, null, 2) + '\n')
console.log(`solc ${SOLC_PINNED}: adapters compiled OK`)
for (const [name, c] of Object.entries(contracts)) {
  console.log(`  ${name}: deployed ${c.deployedBytes} bytes, bytecode sha256 ${c.bytecodeHash}`)
}
console.log(`  warnings: ${artifact.warnings.length}`)
