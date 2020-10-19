# Service Reward

The decentralized services of the EW-DOS utility layer are paid for through a reward pool concept. This means that 
users, or authorized delegated parties (e.g. companies, application developers) pay a fixed fee for accessing a given utility layer service for a pre-defined access period and all the fees are pooled together in a 
smart contract. At the end of the access period, the pool is paid out to the service providers.

The reward pool is the payment contract from the [Utility of the utility token for utilities](https://medium.com/energy-web-insights/the-utility-of-the-utility-token-for-utilities-69c9be603a59)
blog post. As explained in the post:

>1. Companies deposit EWT into a payment contract to gain access to Utility Layer services for a specified number of DIDs, or individual users deposit EWT into a payment contract directly, over a pre-determined length of time (e.g., one year) called the access period.
>1. Based on the EWT balance deposited, the payment contract issues one ERC-20 service token for each DID. The service token exists solely to track usage of the Utility Layer services throughout the access period.
>1. Customers (end-users) create DIDs by using the company’s application (if the end-user does not already have a DID). Whenever a customer creates a DID, the payment contract initiates the access period by activating one service token that is associated with that DID.
>1. Over the course of the access period, the payment contract automatically 1) burns a portion of each DID’s service token and 2) releases a portion of the corresponding EWT balance from the service reward contract to the Utility Layer nodes incrementally. In this way, the ERC-20 service token and the EWT balance in the service reward contract are both exhausted at the end of the access period (e.g., one year).
>1. This process is repeated to extend or renew access to Utility Layer services for DIDs.

## Reward Pool Creation (Constructor)

The Reward Pool is a smart contract which can be created by anyone. It can not be changed after its instantiation. If 
changes are required, a new pool should be created.

The constructor has the following signature:
```
constructor(uint _periodDuration, address _priceOracle, address _payoutAddress)
```  

### Period Duration

The period duration is indicated in seconds and the first access period starts at contract initiation. The current 
implementation allows two periods to be open simultaneously and the periods must be closed by calling the `closePeriod`
function

### Price Oracle

The price for getting access to the system for one access period is labeled in fiat. In order to translate this in 
EWT we need a price oracle which implements the following interface:

```
interface PriceOracleI {
    function getCurrentValue() external view returns (uint);
}
```

The `getCurrentValue` function is expected to return the number of EWT it takes to purchase one unit of fiat currency
(e.g. USD or EUR)

### Payout Address

At the end of each period, when the `closePeriod` function is called, the reward tokens for this period are transferred 
to a specialised payment smart-contract which contains the logic for the distribution of the reward to the service node 
operators.

## Registering a user

Users can self register or get their registration performed by somone else via delegation. No special permission is required for the 
first registration. Once the registration has happened, only the same address can extend or renew the registration.

The `register` function has following signature

```
function register(address registrant, uint multiplier) public payable
```

The parameters are 

* `registrant` is the address to be registered. It must be a valid Ethereum address. This is implementation specific and 
actually not mandated by the contract logic
* `multiplier` is the increase or decrease for the price of this registration and should be used to account for the 
energy intensity of the asset being registered 

The EWT sent in the function call will be used to register the user for as many full access periods as possible based on the current price. 
If some EWT remains after the registration, they will be returned to the sender. It might be tricky to compute exactly 
how many tokens to send as the price is computed per second on a changing token price. Therefore it makes sense to 
simply return whatever change is left over.

A registration always contains one partial access period, the first one. A registration can be done at any time 
and hence the current access period will almost certainly have started when the registration occurs. This is relevant
as the price for the remainder of the current period is computed in seconds and it is difficult to predict in whitch 
block the registration will be performed. Hence the difficulty to compute the price with precision.

The result of the registration is the creation of an entry in the `registrants` mapping

```
struct Registrant {
    address registrar; // the address that is allowed to transfer this account
    uint multiplier; // depending on the kind of asset, every registered address gets a multiplier which indicates its level
    uint expiry; //the time stamp when the membership expires
}

mapping (address => Registrant) public registrants
``` 

Each active registrant has an expiry timestamp in the future. If the timestamp is in the past, the subscription is not
active.

If the registration has been performed by a third party, the address is stored with the registration to make sure that
this party can retain control over the registration. The registrant can also control the subscription themselves.

### Prerequisite for registration

At the very least, an address is registered until the end of the current access period. Which means that the minimum
EWT sent with the function call must equal `Price per second * Remaining Seconds in current period`

Any excess EWT will be used to register for additional access periods. Any remaining EWT will be returned to the 
sender.

### Result of registration

The outcome of the registration is either a successful registration or a revert of the transaction. There can be 2 
reasons for the transaction to fail:

1. The transaction is not signed by the initial registrar or the address to be registered itself
1. Not enough EWT was provided to register for the remainder of the current period or to extend an existing registration 
by a full access period

If the transaction succeeds, 4 things will hapen:

1. The address passed as `registrant` will be added to the `registrants` mapping with an expiry timestamp equal to or 
greater than the end of the current access period which is the `periodEnd` global attribute
1. The global attribute `totalPeriodsRegistered` is incremented by the number of periods purchased (the current 
access period counts as 1 even if it only partial)
1. The mapping `deliveryPeriods[expiry]` is updated to account for the fact that the registrant will leave the number
of registrants in this access period
1. The reward for the current access period is increased by `Price per second * Remaining Seconds in current period`

#### Extending the registration

To ensure continuous access to the system a user should extend their subscription before it expires. This is done by 
calling the `register` function with at least enough EWT to pay for one additional access period. 

When the subscription is extended 4 things happen:

1. the `deliveryPeriods[registrants[registrant].expiry].registrantCount` is increased by one to reflect the fact that
the registrant will not leave at the originally defined time after all
1. the `registrants[registrant].expiry` attribute is updated to the new timestamp 
1. with this new `expiry` timestamp the attribute in `deliveryPeriods[registrants[registrant].expiry].registrantCount` 
is decreased by 1 to account for the fact that the registrant will leave at this time
1. The global attribute `totalPeriodsRegistered` is incremented by the number of periods purchased

#### Edge case: registration before the period has been closed but after the end of the period

In order to close the access period, the corresponding function must be called. But the function can not be called
before the access period has reached its end timestamp and hence it could happen that the timestamp is in the past 
but the `closePeriod` function has not been called yet.

In such a case, the registration is performed on the next access period. But because there is only one `periodEnd`
global attribute in the contract, this mandates that each period be closed before the next period reaches its end. 
Failing to do this, will result in making new registrations impossible until the period has been closed.

## Closing the access period

After the access period has expired, the accrued rewards are transferred to the `payoutAddress`. This must be a 
smart contract implementing the `PayoutI` interface:

```
interface PayoutI {
    function payReward(uint periodEnd) external payable;
}
```

It is the responsibility of this smart-contract to distribute the rewards between the service providers. A simple 
implementation is provided in this repository as an example.

Anyone can call the `closePeriod` function as it does not require special permission and does not provide the 
opportunity for mischief. It will not execute before the time is right as it requires the block timestamp to be 
past the `periodEnd` as expressed in the require:

```
require(block.timestamp >= periodEnd);
```

The function must be called after the current access period ends and before the next access period ends. Failing to 
do this will result in errors in the `register` function.

### Closing Process

Closing the access period includes three parts:

1. Close current access period
    1. Transfer the rewards to the `payoutAddress` by calling its `payReward` function with the timestamp of the begin
    of the access period
    1. Decrease `totalPeriodsRegistered` by the number of `registrantCount` in the access period
1. Open next access period
    1. Roll over the `registrantCount` from the previous access period. If the next access period has fewer 
    registrants, it will have a negative `registrantCount` to allow for correct accounting when rolling the count over
    1. Compute the initial reward for the new access period. This is equal to 
    `totalReward.div(totalPeriodsRegistered).mul(uint(participants))`. The reason this can not be computed by simply 
    multiplying the `registrantCount` byt the price of a access period is that the registrants might have purchased
    their subscription at a time when the price was different. 
1. The last step is to set the next access period as the current access period

## Payout

The simple payout contract provided, splits the rewards evenly among the registered users. In order to receive a payout
the user must have been registered before the begin of the period for which this payout is being made. This is why the
reward pool passess the begin timestamp with the reward payout.

