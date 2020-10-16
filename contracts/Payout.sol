/*
SPDX-License-Identifier: GPL-3.0
*/
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";

contract Payout {
    using SafeMath for uint;

    struct Reward {
        uint memberCount;
        uint rewardAmount;
    }

    address public owner;
    address public rewardPool;

    uint public memberCount = 1;
    uint public newMemberCount;

    mapping(address => uint) public members;
    mapping (uint => Reward) public rewards;

    modifier onlyOwner() {
        require(msg.sender == owner, "this function can only be called by the owner");
        _;
    }

    constructor() public {
        owner = msg.sender;
        members[owner] = block.timestamp;
    }

    function setOwner(address newOwner) public onlyOwner {
        owner = newOwner;
    }

    function setRewardPool(address _rewardPool) external {
        require(rewardPool == address(0x0));
        rewardPool = _rewardPool;
    }

    function addMembers(address[] memory newMembers) public onlyOwner {
        for(uint i = 0; i < newMembers.length; i++) {
            members[newMembers[i]] = block.timestamp;
        }
        newMemberCount = newMemberCount.add(newMembers.length);
    }

    function removeMember(address member) public onlyOwner {
        require(members[member] > 0, "only existing members can be removed");
        require(memberCount > 1, "the last member can not be removed");
        members[member] = 0;
        memberCount = memberCount.sub(1);
    }

    function payReward(uint periodStart) public payable {
        require(msg.sender == rewardPool, "the payout must come from the rewardPool");
        rewards[periodStart].rewardAmount = msg.value.div(memberCount);
        rewards[periodStart].memberCount = memberCount;
        memberCount = memberCount.add(newMemberCount);
        newMemberCount = 0;
    }

    function pullReward(uint periodTimestamp) public {
        require(members[msg.sender] <= periodTimestamp, "the sender is not eligible for this reward");
        require(rewards[periodTimestamp].rewardAmount > 0, "there is no reward for this period");

        msg.sender.transfer(rewards[periodTimestamp].rewardAmount);
    }

}
