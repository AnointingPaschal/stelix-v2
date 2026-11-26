// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./LaunchToken.sol";

/// @title StelixTokenFactory — free ERC-20 token creation on Arc testnet
/// @notice Gas only, no Stelix fee. Anyone can create a fixed-supply token
/// (name, symbol, total supply, decimals 0-18). The full supply is minted
/// to the creator. Every token created here is recorded on-chain so the
/// launchpad and the app can discover it. Tokens are plain ERC-20s with
/// no mint, burn, pause or tax — what is created is what exists.
contract StelixTokenFactory {
    struct TokenInfo {
        address token;
        address creator;
        string name;
        string symbol;
        uint256 totalSupply;
        uint8 decimals;
        uint256 createdAt;
    }

    TokenInfo[] public tokens;
    mapping(address => bool) public isFactoryToken;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        uint8 decimals
    );

    /// @notice Create a token. `totalSupply` is in the token's smallest units.
    function createToken(string calldata name, string calldata symbol, uint256 totalSupply, uint8 decimals)
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
        tokens.push(
            TokenInfo({
                token: token,
                creator: msg.sender,
                name: name,
                symbol: symbol,
                totalSupply: totalSupply,
                decimals: decimals,
                createdAt: block.timestamp
            })
        );
        emit TokenCreated(token, msg.sender, name, symbol, totalSupply, decimals);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function getToken(uint256 index) external view returns (TokenInfo memory) {
        return tokens[index];
    }
}
