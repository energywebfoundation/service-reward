/*
SPDX-License-Identifier: GPL-3.0
*/
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";

interface PriceOracleI {
    function getCurrentValue() external view returns (uint);
}

interface PayoutI {
    function payReward(uint periodEnd) external payable;
    function setRewardPool(address _rewardPool) external;
}

contract RewardPool {
    using SafeMath for uint;
    using SignedSafeMath for int;

    event TokensReturned(address recipient, uint wad);

    struct Registrant {
        address registrar; // the address that is allowed to transfer this account
        uint multiplier; // depending on the kind of asset, every registered address gets a multiplier which indicates its level
        uint expiry; //the time stamp when the membership expires
    }

    struct AccessPeriod {
        // the number of registered addresses in this access period. it is a signed int, so that it can be negative
        // in periodClose the registrantCount is rolled over from the current period to the next. The next period has
        // a negative registrantCount to indicate that some registrants must be removed
        int registrantCount;
        uint rewardAmount;
    }

    uint public totalPeriodsRegistered;
    mapping (address => Registrant) public registrants;

    uint public periodEnd;
    uint public periodDuration;
    PayoutI payoutAddress;
    PriceOracleI public priceOracle;
    uint public priceInFiat = 5;
    mapping (uint => AccessPeriod) public accessPeriods;

    constructor(uint _periodDuration, address _priceOracle, address _payoutAddress) public {
        require(_periodDuration > 0, "the duration must be greater than zero");
        require(PriceOracleI(_priceOracle).getCurrentValue() > 0, "the price oracle must return a value");

        periodEnd = block.timestamp + _periodDuration;
        periodDuration = _periodDuration;
        payoutAddress = PayoutI(_payoutAddress);
        payoutAddress.setRewardPool(address(this));
        priceOracle = PriceOracleI(_priceOracle);
    }

    // returns true if the user's registration has not expired
    function isRegistered(address user) public view returns (bool) {
        return registrants[user].expiry > block.timestamp;
    }

    // returns the current price in native tokens to register for 1 second
    function pricePerSecondInTokens(uint multiplier) public view returns (uint) {
        return priceInFiat * priceOracle.getCurrentValue() / periodDuration * multiplier / 10000;
    }

    /**
    registrant: the address to be registered or whose registration should be extended
    multiplier: the multiplier in basis points. it will be divided by 10'000 in order to determine the actual effect
    */
    function register(address registrant, uint multiplier) public payable {
        require(registrants[registrant].registrar == address(0x0) || registrants[registrant].registrar == msg.sender
        || registrant == msg.sender,
            "the registrar is not empty or the sender is not the registrar");
        require(multiplier > 0, "the multiplier must be a positive integer");
        uint registeredSeconds = 0;
        uint registrationWad = msg.value;
        uint secondPrice = pricePerSecondInTokens(multiplier);
        // the multiplier is set every time in order to allow for changes in it. this will have no effect on past registrations
        registrants[registrant].multiplier = multiplier;
        uint registrationPeriod;
        // the period transition will never happen exactly at the right time but it must happen before the next period ends
        if(periodEnd > block.timestamp) {
            registrationPeriod = periodEnd;
        } else {
            registrationPeriod = periodEnd.add(periodDuration);
        }
        uint remainingSeconds = registrationPeriod.sub(block.timestamp);
        uint registeredPeriods;
        // if the last registration was for a period that has been closed already then it is a new registration
        if(registrants[registrant].expiry < registrationPeriod) {
            // the registration will revert if the msg.value is insufficient
            registrationWad = registrationWad.sub(secondPrice.mul(remainingSeconds));
            // add the registration for the current period only.
            // The following periods will be funded in the closePeriod function
            accessPeriods[registrationPeriod].rewardAmount =
                    accessPeriods[registrationPeriod].rewardAmount.add(secondPrice.mul(remainingSeconds));
            accessPeriods[registrationPeriod].registrantCount =
                    accessPeriods[registrationPeriod].registrantCount.add(1);
            registrants[registrant].expiry = registrationPeriod;
            if (registrants[registrant].registrar == address(0x0)) {
                registrants[registrant].registrar = msg.sender;
            }
            totalPeriodsRegistered = totalPeriodsRegistered.add(1);
        } else {
            accessPeriods[registrants[registrant].expiry + periodDuration].registrantCount =
                    accessPeriods[registrants[registrant].expiry + periodDuration].registrantCount.add(1);
        }

        registeredPeriods = registeredPeriods.add(registrationWad.div(secondPrice).div(periodDuration));
        registeredSeconds = registeredPeriods.mul(periodDuration);

        totalPeriodsRegistered = totalPeriodsRegistered.add(registeredPeriods);
        registrants[registrant].expiry = registrants[registrant].expiry.add(registeredSeconds);
        // pre remove the registrant in the period after the expiry
        accessPeriods[registrants[registrant].expiry + periodDuration].registrantCount =
                accessPeriods[registrants[registrant].expiry + periodDuration].registrantCount.sub(1);

        if(registrationWad.sub(registeredSeconds.mul(secondPrice)) > 0) {
            msg.sender.transfer(registrationWad.sub(registeredSeconds.mul(secondPrice)));
            emit TokensReturned(msg.sender, registrationWad.sub(registeredSeconds.mul(secondPrice)));
        }
    }

    function closePeriod() public {
        require(block.timestamp >= periodEnd);

        uint nextPeriod = periodEnd.add(periodDuration);
        uint totalReward = address(this).balance.sub(accessPeriods[periodEnd].rewardAmount);
        int participants = accessPeriods[nextPeriod].registrantCount.add(accessPeriods[periodEnd].registrantCount);
        totalPeriodsRegistered = totalPeriodsRegistered.sub(uint(accessPeriods[periodEnd].registrantCount));

        if(totalPeriodsRegistered > 0) {
            accessPeriods[nextPeriod].rewardAmount = totalReward.div(totalPeriodsRegistered).mul(uint(participants));
            accessPeriods[nextPeriod].registrantCount = participants;
        } else {
            accessPeriods[nextPeriod].registrantCount = 0;
        }
        payoutAddress.payReward{value: accessPeriods[periodEnd].rewardAmount}(periodEnd.sub(periodDuration));
        periodEnd = nextPeriod;
    }

}
