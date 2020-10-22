const { setWorldConstructor } = require('@cucumber/cucumber');
const {accounts, contract, web3} = require('@openzeppelin/test-environment')
const {expect} = require('chai')
const RewardPoolContract = contract.fromArtifact('RewardPool')
const PriceOracleContract = contract.fromArtifact('PriceOracle')
const PayoutContract = contract.fromArtifact('Payout')

class RewardPoolWorld {

  constructor() {
    this.owner = accounts[0]
    const that = this
    this._initialized = new Promise(async (resolve, reject) => {
      try {
        that.priceOracle = await PriceOracleContract.new()
        that.payout = await PayoutContract.new({from: this.owner})
        that.ready = true
        resolve(true)
       }catch (err) {
        reject(err)
      }
    })
  }

  async newRewardPool(periodDuration) {
    expect(await this._initialized).to.be.true
    return await RewardPoolContract.new(periodDuration, this.priceOracle.address, this.payout.address, {from: this.owner})
  }

}

setWorldConstructor(RewardPoolWorld);
