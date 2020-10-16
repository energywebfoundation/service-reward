const {accounts, contract, web3} = require('@openzeppelin/test-environment')
const help = require('@openzeppelin/test-helpers')
const {expect} = require('chai')

// Load compiled artifacts
const RewardPool = contract.fromArtifact('RewardPool')
const PriceOracle = contract.fromArtifact('PriceOracle')
const Payout = contract.fromArtifact('Payout')

// Start test block
describe('RewardPool', function () {
  const [owner, user1] = accounts
  const BN = help.BN
  let oracle, payout

  function bn(value) {
    return new BN(value.toString())
  }

  before(async function() {
    oracle = await PriceOracle.new()
    payout = await Payout.new()
  })

  it('creates a RewardPool instance when parameters are correct', async function() {
    const rp = await RewardPool.new(1000, oracle.address, payout.address, {from: owner})
    const block = await web3.eth.getBlock('latest')
    expect((await rp.periodEnd()).toString()).to.equal((block.timestamp + 1000).toString())
    expect((await rp.periodDuration()).toString()).to.equal("1000")
    expect((await oracle.getCurrentValue()).toString()).to.equal('100000000000000000')
  })

  it('fails to create a RewardPool instance when parameters are incorrect', async function() {
    const startTimestamp = Math.floor(Date.now() / 1000) - 1000
    await help.expectRevert(RewardPool.new(0, oracle.address, payout.address, {from: owner}),
        'the duration must be greater than zero')
  })

  it('a view function can return a block number', async function() {
    expect((await oracle.getBlockTime()).toString()).to.equal((await help.time.latest()).toString())
  })

  describe('contract functions', function () {

    beforeEach(async function () {
      try {
        payout = await Payout.new()
        this.rp = await RewardPool.new(1000, oracle.address, payout.address, {from: owner})
      } catch (e) {
        console.log(e.message)
      }
    })

    async function checkAccessPeriod(accessPeriod, rewardAmountVal, registrantCountVal) {
      const {registrantCount, rewardAmount} = await accessPeriod
      expect(rewardAmount.toString()).to.equal(rewardAmountVal)
      expect(registrantCount.toString()).to.equal(registrantCountVal)
    }

    // Test case
    it('a non registered user is not recognized', async function() {
      expect(await this.rp.isRegistered(owner)).to.be.false
    })

    it('the price per second is 500000000000000', async function () {
      expect((await this.rp.pricePerSecondInTokens(10000)).toString()).to.be.equal('500000000000000')
    })

    it('registration with 0.5 ETH registers the account for the period', async function() {
      const rcpt = await this.rp.register(user1, 10000, {from: owner, value: '500000000000000000'});
      expect(rcpt.logs.length).to.equal(0)
      const {registrar, expiry} = await this.rp.registrants(user1)
      expect(registrar).to.equal(owner)
      expect(expiry.toString()).to.equal((await this.rp.periodEnd()).toString())
      await checkAccessPeriod(this.rp.accessPeriods((await this.rp.periodEnd()).toString()),
          '500000000000000000', '1')
    })

    it('registration with 1 ETH registers the account for two periods', async function() {
      const rcpt = await this.rp.register(user1, 10000, {from: owner, value: '1000000000000000000'});
      expect(rcpt.logs.length).to.equal(0)
      const {registrar, expiry} = await this.rp.registrants(user1)
      expect(registrar).to.equal(owner)
      expect(expiry.toString()).to.equal((parseInt((await this.rp.periodEnd()).toString()) + 1000).toString())
      const periodEnd = new BN((await this.rp.periodEnd()).toString())
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.toString()),
          '500000000000000000', '1')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(new BN('1000')).toString()),
          '0', '0')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(new BN('2000')).toString()),
          '0', '-1')
    })

    it('registration at half the period yields back the excess ETH', async function() {
      await help.time.increase(500)
      const balance = await help.balance.current(owner)
      const rcpt = await this.rp.register(user1, 10000, {from: owner, value: '500000000000000000'});
      help.expectEvent(rcpt, 'TokensReturned', {recipient: owner, wad: '250000000000000000'})
      const tx = await web3.eth.getTransaction(rcpt.tx)
      const {registrar, expiry} = await this.rp.registrants(user1)
      expect(registrar).to.equal(owner)
      expect(expiry.toString()).to.equal((await this.rp.periodEnd()).toString())
      const newBalance = balance.sub(new BN('250000000000000000')).sub(new BN(rcpt.receipt.gasUsed).mul(new BN(tx.gasPrice)))
      expect((await help.balance.current(owner)).toString()).to.equal(newBalance.toString())
      const periodEnd = new BN((await this.rp.periodEnd()).toString())
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.toString()),
          '250000000000000000', '1')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(new BN('1000')).toString()),
          '0', '-1')
    })

    it('increases the expiry date when registration is extended', async function() {
      let tx = await this.rp.register(user1, 10000, {from: owner, value: '550000000000000000'});
      const block = await web3.eth.getBlock(tx.receipt.blockNumber)
      //sometimes the registration returns a second worth of tokens
      const returnedTokens = bn(await this.rp.periodEnd()).sub(bn(block.timestamp)).mul(bn('50000000000000'))
      help.expectEvent(tx, 'TokensReturned', {recipient: owner, wad: returnedTokens.toString()})
      const {expiry} = await this.rp.registrants(user1)
      expect(expiry.toString()).to.equal((await this.rp.periodEnd()).toString())

      tx = await this.rp.register(user1, 10000, {from: owner, value: '1050000000000000000'});
      help.expectEvent(tx, 'TokensReturned', {recipient: owner, wad: '50000000000000000'})
      const {expiry: expiry1} = await this.rp.registrants(user1)
      expect(expiry1.toString()).to.equal(new BN(await this.rp.periodEnd()).add(new BN('2000')).toString())
      const {registrantCount, rewardAmount} = await this.rp
          .accessPeriods((await this.rp.periodEnd()).toString())
      expect(rewardAmount.toString()).to.equal('500000000000000000')
      expect(registrantCount.toString()).to.equal('1')
      expect((await this.rp.totalPeriodsRegistered()).toString()).to.equal('3');
    })

    it('the registrant count reflects the number of registrants', async function () {
      const periodEnd = bn(await this.rp.periodEnd())
      let skipSeconds = bn(0)
      for(let i = 0; i < 10; i++) {
        let {receipt} = await this.rp.register(accounts[i], 10000,
            {from: accounts[i], value: bn('500000000000000000')
                  .add(bn('125000000000000000').mul(bn(i))).toString()});
        // every 4th registrant registers for an additional period
        expect((await this.rp.registrants(accounts[i])).expiry.toString()).to.equal(bn(periodEnd)
            .add(bn(Math.floor(i / 4) * 1000)).toString())
        const block = await web3.eth.getBlock(receipt.blockNumber)
        // each second which is skipped yields a different result in the available reward
        skipSeconds = skipSeconds.add(bn(1000).sub(periodEnd.sub(bn(block.timestamp))))
      }
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.toString()),
          bn('5000000000000000000')
              .sub(bn(skipSeconds)
                  .mul(bn('500000000000000')))
                  .toString(), '10')

      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('1000')).toString()),
          '0', '-4')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('2000')).toString()),
          '0', '-4')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('3000')).toString()),
          '0', '-2')

      // there should be 28 additional periods registered
      const {registrantCount, rewardAmount} = await this.rp.accessPeriods(periodEnd.toString())
      const totalRewards = await web3.eth.getBalance(this.rp.address)
      expect(bn(8).mul(bn('500000000000000000')).toString()).to
          .equal(bn(totalRewards).sub(rewardAmount).toString())
    })

    it('creates a new period with the correct reward amount', async function() {
      let periodEnd = bn(await this.rp.periodEnd())
      let skipSeconds = bn(0)
      for(let i = 0; i < 10; i++) {
        let {receipt} = await this.rp.register(accounts[i], 10000,
            {from: accounts[i], value: bn('500000000000000000')
                  .add(bn('125000000000000000').mul(bn(i))).toString()});
        const block = await web3.eth.getBlock(receipt.blockNumber)
        // each second which is skipped yields a different result in the available reward
        skipSeconds = skipSeconds.add(bn(1000).sub(periodEnd.sub(bn(block.timestamp))))
      }

      periodEnd = bn(await this.rp.periodEnd())

      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('1000')).toString()),
          '0', '-4')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('2000')).toString()),
          '0', '-4')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn('3000')).toString()),
          '0', '-2')

      // fast forward to end of period
      let rewards = bn('5000000000000000000').sub(bn(skipSeconds).mul(bn('500000000000000')))
      help.time.increaseTo(periodEnd.toString())
      await this.rp.closePeriod()
      expect((await web3.eth.getBalance(payout.address)).toString()).to.equal(rewards.toString())
      expect(bn(await this.rp.periodEnd()).toString()).to.equal(periodEnd.add(bn(1000)).toString())
      periodEnd = periodEnd.add(bn(1000))
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.toString()),
          '3000000000000000000', '6')

      help.time.increaseTo(periodEnd.toString())
      expect(bn(await web3.eth.getBalance(this.rp.address)).toString()).to.equal('4000000000000000000')
      await this.rp.closePeriod()
      expect((await web3.eth.getBalance(payout.address)).toString()).to.equal(rewards.add(bn('3000000000000000000')).toString())
      expect(bn(await this.rp.periodEnd()).toString()).to.equal(periodEnd.add(bn(1000)).toString())
      expect(bn(await web3.eth.getBalance(this.rp.address)).toString()).to.equal('1000000000000000000')

      periodEnd = periodEnd.add(bn(1000))
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.toString()),
          '1000000000000000000', '2')
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn(1000)).toString()),
          '0', '-2')

      help.time.increaseTo(periodEnd.toString())
      await this.rp.closePeriod()
      await checkAccessPeriod(this.rp.accessPeriods(periodEnd.add(bn(1000)).toString()), '0', '0')
      expect((await web3.eth.getBalance(payout.address)).toString()).to
          .equal(rewards.add(bn('4000000000000000000')).toString())
    })

  })
})
