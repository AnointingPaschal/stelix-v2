// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LaunchToken.sol";

/// @title StelixTokenFactory — free ERC-20 token creation on any EVM chain
/// @notice Gas only, no Stelix fee. Anyone can create a fixed-supply token
/// (name, symbol, total supply, decimals 0-18). The full supply is minted
/// to the creator. Every token created here is recorded on-chain so the
/// launchpad and the app can discover it. Tokens are plain ERC-20s with
/// no mint, burn, pause or tax — what is created is what exists.
///
/// @dev Logo: `logoURI` is recorded on-chain with the token (a short
/// https URL — the logo file itself lives off-chain, e.g. served by the
/// Stelix admin — because storing image bytes on-chain would cost far
/// more gas than any block allows). Any reader — the Stelix wallet, the
/// admin, or any other app — can resolve a token's logo from the chain
/// alone via `tokenInfoByAddress(token).logoURI`, so the logo shows
/// wherever the contract address is imported, with no registry needed.
contract StelixTokenFactory {
    struct TokenInfo {
        address token;
        address creator;
        string name;
        string symbol;
        uint256 totalSupply;
        uint8 decimals;
        uint256 createdAt;
        string logoURI;
    }

    TokenInfo[] public tokens;
    mapping(address => bool) public isFactoryToken;
    /// @notice Token record by token address — one eth_call resolves a
    /// token's logo (and name/symbol/supply) with no event indexing.
    mapping(address => TokenInfo) public tokenInfoByAddress;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        uint8 decimals,
        string logoURI
    );

    /// @notice Create a token. `totalSupply` is in the token's smallest units.
    /// `logoURI` is a short https URL to the token's logo image ('' for none).
    function createToken(string calldata name, string calldata symbol, uint256 totalSupply, uint8 decimals, string calldata logoURI)
        external
        returns (address token)
    {
        require(bytes(name).length > 0, "name required");
        require(bytes(symbol).length > 0, "symbol required");
        require(totalSupply > 0, "supply required");
        require(decimals <= 18, "decimals > 18");
        LaunchToken t = new LaunchToken(name, symbol, decimals, totalSupply, msg.sender);
        token = address(t);
        isFactoryToken[token] = true;
        TokenInfo memory info = TokenInfo({
            token: token,
            creator: msg.sender,
            name: name,
            symbol: symbol,
            totalSupply: totalSupply,
            decimals: decimals,
            createdAt: block.timestamp,
            logoURI: logoURI
        });
        tokens.push(info);
        tokenInfoByAddress[token] = info;
        emit TokenCreated(token, msg.sender, name, symbol, totalSupply, decimals, logoURI);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function getToken(uint256 index) external view returns (TokenInfo memory) {
        return tokens[index];
    }

    /// @notice Token record by token address (zeroed struct when the
    /// address was not created by this factory). Prefer this over the
    /// raw mapping getter in Solidity — it returns a typed struct.
    function getTokenByAddress(address tokenAddress) external view returns (TokenInfo memory) {
        return tokenInfoByAddress[tokenAddress];
    }
}
