// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool} from "./interfaces/IPool.sol";

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address user) external view returns (uint256);
}

/// @notice Minimal mock yield pool.
/// - Vault deposits/withdraws underlying token into/from this pool
/// - APY is controlled by Vault (Vault owner can change via StrategyVault.adminSetPoolAPY)
/// - Tracks accounting balances per owner (Vault uses this for NAV)
contract MockPool is IPool {
    address public immutable underlying;   // e.g., mUSDC
    address public vault;                  // StrategyVault
    address public owner;                  // deployer/admin (for setVault, simulateProfit)

    // APY in basis points (bps). e.g. 800 = 8.00%
    uint256 private _apyBps;

    // accounting balances per owner (mainly vault)
    mapping(address => uint256) private _balances;

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);
    event APYUpdated(uint256 oldApyBps, uint256 newApyBps);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    error NotVault();
    error NotOwner();

    constructor(address _underlying, uint256 initialApyBps) {
        require(_underlying != address(0), "underlying=0");
        underlying = _underlying;
        owner = msg.sender;
        _apyBps = initialApyBps;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ===== IPool view =====
    function apy() external view returns (uint256) {
        return _apyBps;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20Like(underlying).balanceOf(address(this));
    }

    function totalAssetsOf(address who) external view returns (uint256) {
        return _balances[who];
    }

    // ===== admin =====

    /// @notice Bind vault after deployment (or update if needed for local dev).
    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "vault=0");
        address old = vault;
        vault = newVault;
        emit VaultUpdated(old, newVault);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }

    /// ✅ Route A 核心：APY 只能由 Vault 调（真实世界里利率不是随便改，这里只是 mock）
    function setAPY(uint256 newApyBps) external onlyVault {
        emit APYUpdated(_apyBps, newApyBps);
        _apyBps = newApyBps;
    }

    /// @notice Simulate profit by transferring tokens into pool.
    /// We attribute profit to the vault position (accounting balance increases).
    function simulateProfit(uint256 amount) external onlyOwner {
        require(amount > 0, "amount=0");
        bool ok = IERC20Like(underlying).transferFrom(msg.sender, address(this), amount);
        require(ok, "profit transferFrom failed");
        require(vault != address(0), "vault not set");
        _balances[vault] += amount;
    }

    // ===== IPool actions =====

    function deposit(uint256 amount) external onlyVault {
        require(amount > 0, "amount=0");
        bool ok = IERC20Like(underlying).transferFrom(msg.sender, address(this), amount);
        require(ok, "transferFrom failed");

        _balances[vault] += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyVault {
        require(amount > 0, "amount=0");
        require(IERC20Like(underlying).balanceOf(address(this)) >= amount, "insufficient pool bal");

        require(_balances[vault] >= amount, "insufficient vault bal");
        _balances[vault] -= amount;

        bool ok = IERC20Like(underlying).transfer(msg.sender, amount);
        require(ok, "transfer failed");

        emit Withdraw(msg.sender, amount);
    }
}
