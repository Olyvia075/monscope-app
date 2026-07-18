// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title  MonScopeLens
/// @notice Onchain read aggregator that powers MonScope, the Monad portfolio
///         tracker. `scan` returns a wallet's native balance, ERC-20 balances and
///         current approval allowances in a single eth_call, so the app reads a
///         whole portfolio in one round-trip instead of dozens.
///
///         Read-only by design. The only state-changing function is `attest`,
///         a permissionless footprint that lets a scan be recorded onchain and
///         drives a public "wallets scanned" counter. MonScope never calls it
///         automatically; the app stays read-only unless a user explicitly acts.
contract MonScopeLens {
    struct Snapshot {
        uint256 nativeBalance;
        uint256[] balances;   // aligned with `tokens`
        uint256[] allowances; // allowance owner -> spenders[i], aligned by index
    }

    // ----------------------------------------------------------------- reads

    /// @notice Native + ERC-20 balances for one owner in a single call.
    function balances(address owner, address[] calldata tokens)
        external
        view
        returns (uint256 nativeBalance, uint256[] memory out)
    {
        nativeBalance = owner.balance;
        out = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            out[i] = _balanceOf(tokens[i], owner);
        }
    }

    /// @notice Current allowance owner -> spenders[i] for each token, one call.
    function allowances(
        address owner,
        address[] calldata tokens,
        address[] calldata spenders
    ) external view returns (uint256[] memory out) {
        require(tokens.length == spenders.length, "length mismatch");
        out = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            out[i] = _allowance(tokens[i], owner, spenders[i]);
        }
    }

    /// @notice Everything MonScope needs for one wallet in a single eth_call:
    ///         native balance, per-token balances, and per-token allowances.
    function scan(
        address owner,
        address[] calldata tokens,
        address[] calldata spenders
    ) external view returns (Snapshot memory s) {
        require(tokens.length == spenders.length, "length mismatch");
        uint256 n = tokens.length;
        s.nativeBalance = owner.balance;
        s.balances = new uint256[](n);
        s.allowances = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            s.balances[i] = _balanceOf(tokens[i], owner);
            s.allowances[i] = _allowance(tokens[i], owner, spenders[i]);
        }
    }

    // --------------------------------------------------- attestation registry

    uint256 public totalScans;
    mapping(address => uint256) public scanCount; // scans recorded per wallet

    event Scanned(address indexed by, address indexed wallet, uint256 indexed count);

    /// @notice Optionally record onchain that `wallet` was scanned. Permissionless,
    ///         costs only gas, and is never invoked by the app automatically.
    function attest(address wallet) external returns (uint256 count) {
        count = ++totalScans;
        unchecked {
            ++scanCount[wallet];
        }
        emit Scanned(msg.sender, wallet, count);
    }

    // ---------------------------------------------------------------- internals
    // staticcall + tolerant decode so one non-standard token never reverts a batch.

    function _balanceOf(address token, address owner) private view returns (uint256) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, owner));
        if (ok && data.length >= 32) return abi.decode(data, (uint256));
        return 0;
    }

    function _allowance(address token, address owner, address spender)
        private
        view
        returns (uint256)
    {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(IERC20.allowance.selector, owner, spender)
        );
        if (ok && data.length >= 32) return abi.decode(data, (uint256));
        return 0;
    }
}
