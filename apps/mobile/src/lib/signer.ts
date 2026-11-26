/**
 * Signing helper — turns the user's session password into a connected
 * signer for one transaction, then drops it.
 *
 * The app never keeps a plaintext key or a signer in memory: unlocking
 * only flips a boolean (see AppContext). Any screen that sends a real
 * transaction asks for the session password again, decrypts the stored
 * wallet (wrong password throws — see lib/wallet.ts), connects it to
 * the active chain's RPC provider, and uses it for exactly that call.
 * The signer is a local variable in the caller and is never stored.
 */
import { ethers } from 'ethers';
import { getChain } from './chains';
import { getProvider } from './balances';
import { unlockWallet } from './wallet';

/** Decrypt the stored wallet with the session password and connect it
 *  to the chain's RPC provider. Throws on a wrong password or when no
 *  wallet is stored. The returned signer must not be stored. */
export async function getSignerForChain(
  password: string,
  chainId: string,
): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  const chain = getChain(chainId);
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new Error(`${chain.name} is not an EVM chain — it has no ethers signer.`);
  }
  const wallet = await unlockWallet(password);
  if (!wallet) throw new Error('No wallet stored on this device.');
  return wallet.connect(getProvider(chain)) as ethers.Wallet | ethers.HDNodeWallet;
}
