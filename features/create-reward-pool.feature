Feature: Create Reward-Pool
  In order to pool rewards
  As an application manager
  I want to instantiate a reward-pool contract

  Scenario: Successful Reward Pool instantiation
    Given The PriceOracle contract has been deployed
    And The Payout contract has been deployed
    When The reward-pool contract is instantiated with 1000, PriceOracle and PayoutAddress
    Then A correct new instance of the reward-pool contract exists

  Scenario: Reward Pool instantiation fails when the period is not a positive integer
    Given The PriceOracle contract has been deployed
    And The Payout contract has been deployed
    When The reward-pool contract is instantiated with 0, PriceOracle and PayoutAddress
    Then A reward pool exception is thrown with "the duration must be greater than zero"
