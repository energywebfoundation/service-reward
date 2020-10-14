/*
SPDX-License-Identifier: GPL-3.0
*/
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";

interface PriceOracleI {
    function getCurrentValue() external view returns (uint);
}

contract RewardPool {
    using SafeMath for uint;
    using SignedSafeMath for int;

    event TokensReturned(address recipient, uint wad);

    struct Registrant {
        address registrar; // the address that is allowed to transfer this account
        uint expiry; //the time stamp when the membership expires
    }

    struct DeliveryPeriod {
        // the number of registered addresses in this delivery period. it is a signed int, so that it can be negative
        // in periodClose the registrantCount is rolled over from the current period to the next. The next period has
        // a negative registrantCount to indicate that some registrants must be removed
        int registrantCount;
        uint rewardAmount;
    }

    uint public totalPeriodsRegistered;
    mapping (address => Registrant) public registrants;

    uint public periodEnd;
    uint public periodDuration;
    PriceOracleI public priceOracle;
    uint public priceInFiat = 5;
    mapping (uint => DeliveryPeriod) public deliveryPeriods;

    constructor(uint _periodDuration, address _priceOracle) public {
        require(_periodDuration > 0, "the duration must be greater than zero");
        require(PriceOracleI(_priceOracle).getCurrentValue() > 0, "the price oracle must return a value");

        periodEnd = block.timestamp + _periodDuration;
        periodDuration = _periodDuration;
        priceOracle = PriceOracleI(_priceOracle);
    }

    function isRegistered(address user) public view returns (bool) {
        return registrants[user].expiry > block.timestamp;
    }

    function pricePerSecondInTokens() public view returns (uint) {
        return priceInFiat * priceOracle.getCurrentValue() / periodDuration;
    }

    function register(address registrant) public payable {
        require(registrants[registrant].registrar == address(0x0) || registrants[registrant].registrar == msg.sender,
            "the registrar is not empty or the sender is not the registrar");
        uint registeredSeconds = 0;
        uint registrationWad = msg.value;
        uint secondPrice = pricePerSecondInTokens();
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
            deliveryPeriods[registrationPeriod].rewardAmount =
                    deliveryPeriods[registrationPeriod].rewardAmount.add(secondPrice.mul(remainingSeconds));
            deliveryPeriods[registrationPeriod].registrantCount =
                    deliveryPeriods[registrationPeriod].registrantCount.add(1);
            registrants[registrant].expiry = registrationPeriod;
            if (registrants[registrant].registrar == address(0x0)) {
                registrants[registrant].registrar = msg.sender;
            }
            totalPeriodsRegistered = totalPeriodsRegistered.add(1);
        } else {
            deliveryPeriods[registrants[registrant].expiry + periodDuration].registrantCount =
                    deliveryPeriods[registrants[registrant].expiry + periodDuration].registrantCount.add(1);
        }

        registeredPeriods = registeredPeriods.add(registrationWad.div(secondPrice).div(periodDuration));
        registeredSeconds = registeredPeriods.mul(periodDuration);

        totalPeriodsRegistered = totalPeriodsRegistered.add(registeredPeriods);
        registrants[registrant].expiry = registrants[registrant].expiry.add(registeredSeconds);
        // pre remove the registrant in the period after the expiry
        deliveryPeriods[registrants[registrant].expiry + periodDuration].registrantCount =
                deliveryPeriods[registrants[registrant].expiry + periodDuration].registrantCount.sub(1);

        if(registrationWad.sub(registeredSeconds.mul(secondPrice)) > 0) {
            msg.sender.transfer(registrationWad.sub(registeredSeconds.mul(secondPrice)));
            emit TokensReturned(msg.sender, registrationWad.sub(registeredSeconds.mul(secondPrice)));
        }
    }

    function closePeriod() public {
        require(block.timestamp >= periodEnd);

        uint nextPeriod = periodEnd.add(periodDuration);
        uint totalReward = address(this).balance.sub(deliveryPeriods[periodEnd].rewardAmount);
        int participants = deliveryPeriods[nextPeriod].registrantCount.add(deliveryPeriods[periodEnd].registrantCount);
        totalPeriodsRegistered = totalPeriodsRegistered.sub(uint(deliveryPeriods[periodEnd].registrantCount));

        deliveryPeriods[nextPeriod].rewardAmount = totalReward.div(totalPeriodsRegistered).mul(uint(participants));
        deliveryPeriods[nextPeriod].registrantCount = deliveryPeriods[nextPeriod].registrantCount
                .add(deliveryPeriods[periodEnd].registrantCount);
        msg.sender.transfer(deliveryPeriods[periodEnd].rewardAmount);
        periodEnd = nextPeriod;
    }

}
