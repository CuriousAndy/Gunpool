// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Unified Pool interface for both MockPool and future real-protocol adapters.
/// Vault should ONLY depend on this interface.
interface IPool {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;

    /// @notice Pool contract underlying balance (contract balance).
    function totalAssets() external view returns (uint256);

    /// @notice Accounting assets of an owner (Vault uses this for NAV).
    function totalAssetsOf(address who) external view returns (uint256);

    /// @notice Annual Percentage Yield in basis points (bps). e.g. 800 = 8.00%
    function apy() external view returns (uint256);
}
