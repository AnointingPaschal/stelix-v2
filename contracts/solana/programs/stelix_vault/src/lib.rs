// StelixVault Anchor program — SKELETON ONLY (not compiled / not audited).
// Mirrors the EVM StelixVault lock model with the same UX and rules:
//   lock = date OR price target, whichever first; ladder stages;
//   trailing stop; auto-sell to USDT via Jupiter; break modes
//   Immutable / Penalty (24h cooling-off, 5-10%) / Guardian (Phase 2).
// Jupiter swap integration is a STUB (see TODO in execute_trigger):
// the real CPI needs the Jupiter Aggregator v6 program, the route
// accounts, and a TWAP/oracle price check before mainnet.
// Build (requires Anchor + Solana CLI, neither installed in this VM):
//   anchor build && anchor deploy --provider.cluster devnet
// Then register the program ID in the admin Chain Manager, exactly as
// for an EVM deployment. Devnet first, same testnet-first rule.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("StelixVault1111111111111111111111111111111111");

#[program]
pub mod stelix_vault {
    use super::*;

    /// Create a Bull Lock: move `amount` of the token into the vault PDA.
    /// `targets` = ladder stages (target_price, sell_bps); must be
    /// ascending and total <= 10_000 bps. `unlock_time` is a unix timestamp.
    pub fn create_lock(
        ctx: Context<CreateLock>,
        amount: u64,
        entry_price: u64, // USD, 6 decimals (matches USDC/USDT on Solana)
        unlock_time: i64,
        targets: Vec<LadderStage>,
        trailing_stop_bps: u16,
        break_mode: BreakMode,
        penalty_bps: u16,
        auto_sell: bool,
        slippage_bps: u16,
        min_receive_per_stage: u64,
    ) -> Result<()> {
        require!(amount > 0, StelixError::InvalidParams);
        require!(unlock_time > Clock::get()?.unix_timestamp, StelixError::InvalidParams);
        require!(slippage_bps <= 5000, StelixError::InvalidParams);
        if break_mode == BreakMode::Penalty {
            require!((500..=1000).contains(&penalty_bps), StelixError::InvalidParams);
        }
        let mut total_bps: u32 = 0;
        let mut prev: u64 = 0;
        for s in &targets {
            require!(s.target_price > prev, StelixError::InvalidParams);
            require!(s.sell_bps > 0, StelixError::InvalidParams);
            total_bps += s.sell_bps as u32;
            prev = s.target_price;
        }
        require!(total_bps <= 10_000, StelixError::InvalidParams);

        let lock = &mut ctx.accounts.lock;
        lock.owner = ctx.accounts.owner.key();
        lock.token_mint = ctx.accounts.token_mint.key();
        lock.amount_remaining = amount;
        lock.amount_total = amount;
        lock.entry_price = entry_price;
        lock.unlock_time = unlock_time;
        lock.targets = targets;
        lock.trailing_stop_bps = trailing_stop_bps;
        lock.peak_price = entry_price;
        lock.break_mode = break_mode;
        lock.penalty_bps = penalty_bps;
        lock.auto_sell = auto_sell;
        lock.slippage_bps = slippage_bps;
        lock.min_receive_per_stage = min_receive_per_stage;
        lock.status = LockStatus::Active;
        lock.break_requested_at = 0;

        // Pull tokens into the vault PDA (checks-effects-interactions:
        // state above is written before this CPI).
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;
        emit!(Locked {
            lock: lock.key(),
            owner: lock.owner,
            amount,
            unlock_time
        });
        Ok(())
    }

    /// Owner claims remaining tokens after `unlock_time`. No keeper needed.
    /// Penalty-free by construction.
    pub fn claim_matured(ctx: Context<ClaimMatured>) -> Result<()> {
        let lock = &mut ctx.accounts.lock;
        require!(lock.status == LockStatus::Active || lock.status == LockStatus::PartiallySold, StelixError::InvalidParams);
        require!(Clock::get()?.unix_timestamp >= lock.unlock_time, StelixError::NotMatured);
        let amount = lock.amount_remaining;
        require!(amount > 0, StelixError::InvalidParams);
        lock.amount_remaining = 0;
        lock.status = LockStatus::Matured;
        // TODO: transfer `amount` from vault_token_account to owner
        // via PDA-signed CPI (vault PDA is the token-account authority).
        emit!(Matured { lock: lock.key(), owner: lock.owner, amount });
        Ok(())
    }

    /// Keeper-only. Sells due ladder stages / trailing-stop remainder.
    /// TODO (before any real deployment):
    ///   1. Verify the 30-min TWAP / oracle price on-chain (Pyth / DEX
    ///      TWAP) — the keeper must NOT supply the price.
    ///   2. Jupiter Aggregator v6 CPI: swap the due stage to USDT (SPL)
    ///      with slippage + min-receive enforced; on failure, abort the
    ///      whole instruction so the lock is untouched (fail-safe).
    ///   3. Pay USDT to the lock owner; update peak / stage state first.
    pub fn execute_trigger(_ctx: Context<ExecuteTrigger>) -> Result<()> {
        // STUB — intentionally unimplemented. Returning an error rather
        // than a half-built swap so nothing can be deployed half-done.
        Err(StelixError::JupiterIntegrationTodo.into())
    }

    /// Owner starts the cooling-off clock (24h Penalty / 48h Guardian).
    /// Immutable locks revert. Guardian execution is Phase 2.
    pub fn request_break(ctx: Context<BreakLock>) -> Result<()> {
        let lock = &mut ctx.accounts.lock;
        require!(lock.break_mode != BreakMode::Immutable, StelixError::ImmutableLock);
        require!(lock.break_requested_at == 0, StelixError::InvalidParams);
        lock.break_requested_at = Clock::get()?.unix_timestamp;
        emit!(BreakRequested { lock: lock.key(), owner: lock.owner });
        Ok(())
    }

    /// Owner executes a break after cooling-off; stored penalty applies.
    pub fn execute_break(ctx: Context<BreakLock>) -> Result<()> {
        let lock = &mut ctx.accounts.lock;
        require!(lock.break_mode == BreakMode::Penalty, StelixError::GuardianBreakNotEnabled);
        require!(lock.break_requested_at > 0, StelixError::BreakNotRequested);
        require!(
            Clock::get()?.unix_timestamp >= lock.break_requested_at + 24 * 3600,
            StelixError::CoolingOffNotElapsed
        );
        let amount = lock.amount_remaining;
        let penalty = amount * lock.penalty_bps as u64 / 10_000;
        lock.amount_remaining = 0;
        lock.status = LockStatus::Broken;
        // TODO: PDA-signed transfers — `penalty` to penalty recipient,
        // `amount - penalty` to the owner.
        emit!(Broken { lock: lock.key(), owner: lock.owner, returned: amount - penalty, penalty });
        Ok(())
    }
}

// --- Accounts ---------------------------------------------------------
#[derive(Accounts)]
pub struct CreateLock<'info> {
    #[account(init, payer = owner, space = 8 + Lock::MAX_SIZE)]
    pub lock: Account<'info, Lock>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimMatured<'info> {
    #[account(mut, has_one = owner)]
    pub lock: Account<'info, Lock>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExecuteTrigger<'info> {
    #[account(mut)]
    pub lock: Account<'info, Lock>,
    /// CHECK: keeper address checked against the stored keeper in the
    /// config account (TODO: add a Config account holding keeper/router).
    pub keeper: Signer<'info>,
}

#[derive(Accounts)]
pub struct BreakLock<'info> {
    #[account(mut, has_one = owner)]
    pub lock: Account<'info, Lock>,
    pub owner: Signer<'info>,
}

// --- State ------------------------------------------------------------
#[account]
pub struct Lock {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub amount_remaining: u64,
    pub amount_total: u64,
    pub entry_price: u64,
    pub unlock_time: i64,
    pub targets: Vec<LadderStage>, // (target_price, sell_bps, sold)
    pub trailing_stop_bps: u16,
    pub peak_price: u64,
    pub break_mode: BreakMode,
    pub penalty_bps: u16,
    pub auto_sell: bool,
    pub slippage_bps: u16,
    pub min_receive_per_stage: u64,
    pub status: LockStatus,
    pub break_requested_at: i64,
}

impl Lock {
    // Conservative upper bound: 8 stages max in practice.
    pub const MAX_SIZE: usize = 32 + 32 + 8 * 5 + 8 + 8 + (4 + 8 * 24) + 2 + 8 + 1 + 2 + 1 + 2 + 8 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LadderStage {
    pub target_price: u64,
    pub sell_bps: u16,
    pub sold: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum BreakMode {
    Immutable,
    Penalty,
    Guardian, // Phase 2
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum LockStatus {
    Active,
    PartiallySold,
    Completed,
    Matured,
    Broken,
}

// --- Events / errors --------------------------------------------------
#[event]
pub struct Locked { pub lock: Pubkey, pub owner: Pubkey, pub amount: u64, pub unlock_time: i64 }
#[event]
pub struct Matured { pub lock: Pubkey, pub owner: Pubkey, pub amount: u64 }
#[event]
pub struct BreakRequested { pub lock: Pubkey, pub owner: Pubkey }
#[event]
pub struct Broken { pub lock: Pubkey, pub owner: Pubkey, pub returned: u64, pub penalty: u64 }

#[error_code]
pub enum StelixError {
    #[msg("Invalid lock parameters")]
    InvalidParams,
    #[msg("Lock has not matured yet")]
    NotMatured,
    #[msg("Immutable lock cannot be broken")]
    ImmutableLock,
    #[msg("No break was requested")]
    BreakNotRequested,
    #[msg("Cooling-off period has not elapsed")]
    CoolingOffNotElapsed,
    #[msg("Guardian break is Phase 2 and not enabled yet")]
    GuardianBreakNotEnabled,
    #[msg("Jupiter swap integration is a TODO stub — not deployable")]
    JupiterIntegrationTodo,
}
