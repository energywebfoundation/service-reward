/*
SPDX-License-Identifier: GPL-3.0
*/
pragma solidity ^0.6.12;

contract PriceOracle {
    uint256 public getCurrentValue = 100000000000000000;

    function getBlockTime() public view returns (uint256) {
        return block.timestamp;
    }
}
