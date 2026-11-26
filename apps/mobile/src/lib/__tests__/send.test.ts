/**
 * Send tests — validation + signed-transfer flow against a fake
 * signer/provider. No network, no funds moved. Run: npm test
 */
import { ethers } from 'ethers';
import { estimateSendFee, sendToken, SendValidationError, type SendRequest } from '../send';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const FAKE_HASH = `0x${'ab'.repeat(32)}`;

function makeFakeProvider(tokenBalance: bigint) {
  return {
    getBalance: async () => ethers.parseEther('10'),
    estimateGas: async () => 21_000n,
    getFeeData: async () => ({ gasPrice: 1_000_000_000n, maxFeePerGas: null, maxPriorityFeePerGas: null }),
    call: async (tx: { data?: string }) => {
      // balanceOf(address) selector 0x70a08231
      if (tx.data?.startsWith('0x70a08231')) {
        return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [tokenBalance]);
      }
      return '0x';
    },
  };
}

function makeFakeSigner(provider: ReturnType<typeof makeFakeProvider>) {
  const sent: Record<string, unknown>[] = [];
  const signer = {
    getAddress: async () => FROM,
    provider,
    sendTransaction: async (tx: Record<string, unknown>) => {
      sent.push(tx);
      return { hash: FAKE_HASH, wait: async () => ({ hash: FAKE_HASH, blockNumber: 123 }) };
    },
  };
  return { signer: signer as never, sent };
}

const nativeReq: SendRequest = {
  chainId: 'bnb',
  tokenAddress: '',
  tokenSymbol: 'BNB',
  tokenDecimals: 18,
  to: TO,
  amount: 0.5,
};

const tokenReq: SendRequest = {
  chainId: 'bnb',
  tokenAddress: TOKEN,
  tokenSymbol: 'USDT',
  tokenDecimals: 6,
  to: TO,
  amount: 10,
};

describe('send validation (no transaction is ever built)', () => {
  it('rejects an invalid recipient', async () => {
    const { signer } = makeFakeSigner(makeFakeProvider(100n));
    await expect(sendToken(signer, { ...nativeReq, to: 'not-an-address' })).rejects.toThrow(SendValidationError);
  });

  it('rejects the zero address', async () => {
    const { signer } = makeFakeSigner(makeFakeProvider(100n));
    await expect(sendToken(signer, { ...nativeReq, to: ethers.ZeroAddress })).rejects.toThrow(/zero address/);
  });

  it('rejects sending to yourself', async () => {
    const { signer } = makeFakeSigner(makeFakeProvider(100n));
    await expect(sendToken(signer, { ...nativeReq, to: FROM })).rejects.toThrow(/own address/);
  });

  it('rejects zero and negative amounts', async () => {
    const { signer } = makeFakeSigner(makeFakeProvider(100n));
    await expect(sendToken(signer, { ...nativeReq, amount: 0 })).rejects.toThrow(/greater than 0/);
    await expect(sendToken(signer, { ...nativeReq, amount: -1 })).rejects.toThrow(/greater than 0/);
  });

  it('rejects amounts with too many decimals for the token', async () => {
    const { signer } = makeFakeSigner(makeFakeProvider(100n));
    await expect(sendToken(signer, { ...tokenReq, amount: 0.0000001 })).rejects.toThrow(/too many decimals/);
  });

  it('estimateSendFee validates before touching the network', async () => {
    await expect(estimateSendFee({ ...nativeReq, to: 'bad' }, FROM)).rejects.toThrow(SendValidationError);
    await expect(estimateSendFee({ ...nativeReq, amount: 0 }, FROM)).rejects.toThrow(/greater than 0/);
  });
});

describe('sendToken with a fake signer', () => {
  it('sends native value with the exact amount', async () => {
    const provider = makeFakeProvider(0n);
    const { signer, sent } = makeFakeSigner(provider);
    const res = await sendToken(signer, nativeReq);
    expect(res.hash).toBe(FAKE_HASH);
    expect(res.blockNumber).toBe(123);
    expect(res.from).toBe(FROM);
    expect(res.to).toBe(TO);
    expect(res.amountRaw).toBe(ethers.parseEther('0.5').toString());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TO);
    expect(sent[0].value).toBe(ethers.parseEther('0.5'));
  });

  it('refuses a native send that exceeds balance + gas', async () => {
    const provider = makeFakeProvider(0n);
    provider.getBalance = async () => ethers.parseEther('0.1');
    const { signer, sent } = makeFakeSigner(provider);
    await expect(sendToken(signer, { ...nativeReq, amount: 0.5 })).rejects.toThrow(/Insufficient balance/);
    expect(sent).toHaveLength(0);
  });

  it('sends an ERC-20 transfer with the exact raw amount', async () => {
    const provider = makeFakeProvider(ethers.parseUnits('100', 6));
    const { signer, sent } = makeFakeSigner(provider);
    const res = await sendToken(signer, tokenReq);
    expect(res.hash).toBe(FAKE_HASH);
    expect(res.amountRaw).toBe(ethers.parseUnits('10', 6).toString());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TOKEN);
    expect(sent[0].value).toBe(0n);
    // data is transfer(to, 10 USDT)
    const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
    expect(iface.decodeFunctionData('transfer', sent[0].data as string).to).toBe(TO);
  });

  it('refuses an ERC-20 send above the token balance', async () => {
    const provider = makeFakeProvider(ethers.parseUnits('5', 6));
    const { signer, sent } = makeFakeSigner(provider);
    await expect(sendToken(signer, tokenReq)).rejects.toThrow(/Insufficient USDT balance/);
    expect(sent).toHaveLength(0);
  });
});
