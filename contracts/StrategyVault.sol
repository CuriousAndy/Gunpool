// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool} from "./interfaces/IPool.sol";

/* =========================
   Minimal ERC20 interface
========================= */
interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address user) external view returns (uint256);
}

/// Route A：可调 APY（仅 mock）
interface IAdjustableAPY {
    function setAPY(uint256 newApyBps) external;
}

contract StrategyVault {
    IERC20Like public immutable asset;
    address public owner;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    address[] public pools;
    mapping(address => bool) public isPool;
    mapping(address => uint256) public allocated;

    address public activePool;

    // --- Simplified rebalance cost model ---
    // Constant gas cost (in `asset` smallest units), used as a threshold.
    uint256 public gasCostAssets;
    // Time window (in seconds) used to estimate expected gain from APY difference.
    uint256 public gainWindowSeconds;

    /* ========================= EVENTS ========================= */

    event PoolAdded(address indexed pool);
    event ActivePoolUpdated(address indexed oldPool, address indexed newPool);
    event Rebalanced(address indexed fromPool, address indexed toPool, uint256 amount);
    event PoolAPYUpdated(address indexed pool, uint256 oldApy, uint256 newApy);
    event RebalanceParamsUpdated(uint256 gasCostAssets, uint256 gainWindowSeconds);

    /* ========================= ERRORS ========================= */

    error NotOwner();
    error InvalidPool();
    error NoPools();
    error TransferFailed();
    error AmountZero();
    error InsufficientShares();
    error NoBetterPool();
    error InsufficientGain(uint256 expectedGain, uint256 gasCost);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _asset) {
        asset = IERC20Like(_asset);
        owner = msg.sender;

        // --- Rebalance cost model (simplified, thesis-friendly) ---
        // Treat gas cost as a configurable constant in `asset` units (e.g. USDC 6 decimals).
        // Gain is estimated over a fixed time window.
        gasCostAssets = 50_000; // 0.05 USDC if asset has 6 decimals
        gainWindowSeconds = 7 days;
    }

    /* ========================= POOLS ========================= */

    function addPool(address pool) external onlyOwner {
        if (pool == address(0) || isPool[pool]) revert InvalidPool();
        isPool[pool] = true;
        pools.push(pool);

        if (activePool == address(0)) {
            activePool = pool;
            emit ActivePoolUpdated(address(0), pool);
        }

        emit PoolAdded(pool);
    }

    /* ========================= ADMIN: set APY (mock) ========================= */

    function adminSetPoolAPY(address pool, uint256 newApyBps) external onlyOwner {
        if (!isPool[pool]) revert InvalidPool();

        uint256 old = IPool(pool).apy();
        IAdjustableAPY(pool).setAPY(newApyBps);

        emit PoolAPYUpdated(pool, old, newApyBps);
    }

    /* ========================= REBALANCE COST MODEL (SIMPLIFIED) ========================= */

    /// @notice Update simplified rebalance parameters.
    /// @dev `gasCostAssets` is a constant in `asset` units (e.g. USDC 6 decimals).
    ///      `gainWindowSeconds` is the horizon used to estimate expected gain from APY difference.
    function setRebalanceParams(uint256 _gasCostAssets, uint256 _gainWindowSeconds) external onlyOwner {
        gasCostAssets = _gasCostAssets;
        gainWindowSeconds = _gainWindowSeconds;
        emit RebalanceParamsUpdated(_gasCostAssets, _gainWindowSeconds);
    }

    /// @notice Expected gain (in `asset` units) if we move from `fromPool` to `toPool`,
    ///         estimated over `gainWindowSeconds`.
    /// @dev Uses: totalAssets * (apyDiffBps/10000) * (window/365d)
    function expectedGainIfRebalance(address fromPool, address toPool) public view returns (uint256) {
        if (fromPool == address(0) || toPool == address(0)) return 0;

        uint256 fromApy = IPool(fromPool).apy();
        uint256 toApy = IPool(toPool).apy();
        if (toApy <= fromApy) return 0;

        uint256 apyDiffBps = toApy - fromApy;
        uint256 assets_ = totalAssets();

        // assets * apyDiffBps * window / (10000 * 365 days)
        return (assets_ * apyDiffBps * gainWindowSeconds) / (10_000 * 365 days);
    }

    /* ========================= NAV ========================= */

    function totalAssets() public view returns (uint256 sum) {
        sum = asset.balanceOf(address(this));
        for (uint256 i = 0; i < pools.length; i++) {
            sum += IPool(pools[i]).totalAssetsOf(address(this));
        }
    }

    function _toShares(uint256 assets_) internal view returns (uint256) {
        if (totalShares == 0) return assets_;
        return (assets_ * totalShares) / totalAssets();
    }

    function _toAssets(uint256 shares) internal view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares * totalAssets()) / totalShares;
    }

    /* ========================= DEPOSIT / WITHDRAW ========================= */

    function deposit(uint256 amount) external {
        if (amount == 0) revert AmountZero();
        uint256 shares = _toShares(amount);

        asset.transferFrom(msg.sender, address(this), amount);
        asset.approve(activePool, amount);
        IPool(activePool).deposit(amount);

        allocated[activePool] += amount;
        totalShares += shares;
        sharesOf[msg.sender] += shares;
    }

    function withdraw(uint256 shares) external {
        if (shares == 0) revert AmountZero();
        if (sharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 assets_ = _toAssets(shares);

        // pull from active pool if needed
        uint256 bal = asset.balanceOf(address(this));
        if (bal < assets_) {
            uint256 need = assets_ - bal;
            IPool(activePool).withdraw(need);
            allocated[activePool] -= need;
        }

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;

        bool ok = asset.transfer(msg.sender, assets_);
        if (!ok) revert TransferFailed();
    }

    /* ========================= STRATEGY ========================= */

    function poolsLength() external view returns (uint256) {
        return pools.length;
    }

    function bestPool() public view returns (address best) {
        if (pools.length == 0) return address(0);
        uint256 bestApy;
        best = pools[0];
        for (uint256 i = 0; i < pools.length; i++) {
            uint256 a = IPool(pools[i]).apy();
            if (a > bestApy) {
                bestApy = a;
                best = pools[i];
            }
        }
    }

    function rebalance() external onlyOwner {
        address target = bestPool();
        if (target == address(0)) revert NoPools();

        // If already in the best pool, no action needed.
        if (target == activePool) return;

        // Ensure the APY improvement over the current active pool is real.
        uint256 gain = expectedGainIfRebalance(activePool, target);
        if (gain == 0) revert NoBetterPool();

        // Cost constraint: only rebalance if expected gain can cover the (simplified) gas cost.
        if (gain < gasCostAssets) revert InsufficientGain(gain, gasCostAssets);

        for (uint256 i = 0; i < pools.length; i++) {
            address p = pools[i];
            if (p == target) continue;

            uint256 amt = allocated[p];
            if (amt == 0) continue;

            IPool(p).withdraw(amt);
            allocated[p] = 0;
            emit Rebalanced(p, target, amt);
        }

        uint256 bal = asset.balanceOf(address(this));
        if (bal > 0) {
            asset.approve(target, bal);
            IPool(target).deposit(bal);
            allocated[target] += bal;
        }

        activePool = target;
    }
}
