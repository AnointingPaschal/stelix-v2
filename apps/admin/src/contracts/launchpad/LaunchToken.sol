// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LaunchToken — minimal fixed-supply ERC-20 minted by the factory
/// @notice No mint/burn/pause after creation. The full supply goes to the
/// creator at deployment; the factory records the token. Decimals are set
/// at creation (0-18). Standard ERC-20 events; no fees, no taxes.
contract LaunchToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _totalSupply, address _creator) {
        require(_creator != address(0), "creator required");
        require(_totalSupply > 0, "supply required");
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = _totalSupply;
        balanceOf[_creator] = _totalSupply;
        emit Transfer(address(0), _creator, _totalSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(balanceOf[msg.sender] >= value, "insufficient balance");
        require(to != address(0), "zero address");
        unchecked {
            balanceOf[msg.sender] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        require(spender != address(0), "zero address");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(balanceOf[from] >= value, "insufficient balance");
        require(allowance[from][msg.sender] >= value, "insufficient allowance");
        require(to != address(0), "zero address");
        unchecked {
            allowance[from][msg.sender] -= value;
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
