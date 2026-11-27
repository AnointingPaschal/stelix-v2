// Stelix Admin — Contract Studio deploy parameters. Shared by the Worker
// (server-side validation + mainnet gate) and the Contract Studio page, so
// the form and the API enforce the same rules. The constructor is exactly
// StelixVault(address owner, address keeper, address router, address
// priceFeed, address penaltyRecipient, address feeRecipient, uint16
// autoSellFeeBps) — feeBps max 1000 (10%). No mainnet deploy is ever
// performed by this code; the deployer flow (Foundry script, testnet-only
// key) broadcasts, and the admin only registers a verified address.
export interface DeployParams {
  chainId: string
  env: 'testnet' | 'mainnet'
  owner: string
  keeper: string
  router: string
  priceFeed: string
  penaltyRecipient: string
  feeRecipient: string
  autoSellFeeBps: number
  address?: string
  txHash?: string
  sourceHash?: string
}

export const isAddress = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
export const isTxHash = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)

export function mainnetConfirmPhrase(chainName: string): string {
  // The phrase must name the selected network, once, without a doubled
  // suffix. Chain names arrive as "Arc Testnet", "Arc Mainnet", or a
  // plain name like "BNB Smart Chain". A name already ending in
  // " Mainnet" is used as-is; a name ending in " Testnet" has that
  // suffix stripped before " mainnet" is appended — otherwise "Arc
  // Testnet" produced the nonsense "Deploy StelixVault to Arc Testnet
  // mainnet" (reported 2026-11-27). The Worker checks the same phrase
  // against the D1 chain name, so "Arc Mainnet" keeps its capital M.
  const name = chainName.trim()
  if (/ Mainnet$/i.test(name)) return `Deploy StelixVault to ${name}`
  const base = name.replace(/ Testnet$/i, '')
  return `Deploy StelixVault to ${base} mainnet`
}

/**
 * The testnet counterpart of a chain slug: "arc-mainnet" -> "arc" (the
 * verified testnet deployment and the testnet flow that gate a mainnet
 * deploy live under the testnet row), anything else -> itself. Shared by
 * the Contract Studio page and the Worker mainnet gate so both agree.
 */
export function testnetChainIdFor(chainId: string): string {
  return chainId.endsWith('-mainnet') ? chainId.slice(0, -'-mainnet'.length) : chainId
}

export function validateDeployParams(input: unknown): { params: DeployParams | null; errors: string[] } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return { params: null, errors: ['deploy parameters must be an object'] }
  const p = input as Record<string, unknown>
  if (typeof p.chainId !== 'string' || p.chainId.trim() === '') errors.push('chainId is required')
  if (p.env !== 'testnet' && p.env !== 'mainnet') errors.push('env must be testnet or mainnet')
  for (const field of ['owner', 'keeper', 'router', 'priceFeed', 'penaltyRecipient', 'feeRecipient'] as const) {
    if (!isAddress(p[field])) errors.push(`${field} must be a valid 0x address`)
  }
  const feeBps = typeof p.autoSellFeeBps === 'number' ? p.autoSellFeeBps : Number(p.autoSellFeeBps)
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    errors.push('autoSellFeeBps must be an integer between 0 and 1000 (max 10%)')
  }
  if (p.address !== undefined && !isAddress(p.address)) errors.push('address must be a valid 0x address')
  if (p.txHash !== undefined && p.txHash !== '' && !isTxHash(p.txHash)) errors.push('txHash must be a valid 0x transaction hash')
  if (p.sourceHash !== undefined && (typeof p.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.sourceHash))) {
    errors.push('sourceHash must be a sha256 hex string')
  }
  if (errors.length > 0) return { params: null, errors }
  return {
    params: {
      chainId: (p.chainId as string).trim(),
      env: p.env as 'testnet' | 'mainnet',
      owner: p.owner as string,
      keeper: p.keeper as string,
      router: p.router as string,
      priceFeed: p.priceFeed as string,
      penaltyRecipient: p.penaltyRecipient as string,
      feeRecipient: p.feeRecipient as string,
      autoSellFeeBps: feeBps,
      address: p.address as string | undefined,
      txHash: (p.txHash as string | undefined) || undefined,
      sourceHash: p.sourceHash as string | undefined,
    },
    errors,
  }
}
