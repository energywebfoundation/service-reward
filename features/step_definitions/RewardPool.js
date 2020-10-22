const {Given, When, Then} = require('@cucumber/cucumber');
const {expect} = require('chai')
const {accounts, contract, web3} = require('@openzeppelin/test-environment')
const help = require('@openzeppelin/test-helpers')

Given(/^The PriceOracle contract has been deployed$/, async function () {
  expect(await this._initialized).to.be.true
  expect((await this.priceOracle.getCurrentValue()).toString()).to.equal('100000000000000000')
});

Given(/^The Payout contract has been deployed$/, async function () {
  expect(await this._initialized).to.be.true
  expect((await this.payout.owner())).to.equal(this.owner)
});

When(/^The reward\-pool contract is instantiated with (.*), PriceOracle and PayoutAddress$/, async function (period) {
  try {
    this.rewardPool = await this.newRewardPool(period)
  } catch (e) {
    this.rewardPoolError = e
  }
});

Then(/^A correct new instance of the reward\-pool contract exists$/, async function () {
  const rp = this.rewardPool
  const block = await web3.eth.getBlock('latest')
  expect((await rp.periodEnd()).toString()).to.equal((block.timestamp + 1000).toString())
  expect((await rp.periodDuration()).toString()).to.equal("1000")

});

Then(/^A reward pool exception is thrown with "([^"]*)"$/, function (message) {
  expect(this.rewardPoolError.message).to.contain(message)
});
