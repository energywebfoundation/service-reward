const {accounts, contract, web3} = require('@openzeppelin/test-environment')
const help = require('@openzeppelin/test-helpers')
const {expect} = require('chai')

// Load compiled artifacts
const Payout = contract.fromArtifact('Payout')

// Start test block
describe('Payout', function () {
  const [owner, user1, user2, user3, user4] = accounts
  const BN = help.BN

  function bn(value) {
    return new BN(value.toString())
  }

  beforeEach(async function () {
    this.payout = await Payout.new({from: owner})
    this.block = await web3.eth.getBlock('latest')
    await this.payout.setRewardPool(owner)
    this.startTimestamp = Math.floor(Date.now() / 1000)
  })

  it('has the owner as the rewardPool address', async function () {
    expect(await this.payout.rewardPool()).to.equal(owner)
  })

  it('only the owner can call setOwner, addMembers or removeMembers', async function () {
    await help.expectRevert(this.payout.setOwner(user1, {from: user1}),
        'this function can only be called by the owner')
    await help.expectRevert(this.payout.addMembers([user1], {from: user1}),
        'this function can only be called by the owner')
    await help.expectRevert(this.payout.removeMember(user1, {from: user1}),
        'this function can only be called by the owner')
  })

  it('can not remove mebers which have not been added', async function () {
    await help.expectRevert(this.payout.removeMember(user1, {from: owner}), 'only existing members can be removed')
  })

  it('the owner can not remove themself if they are the only member', async function () {
    expect((await this.payout.members(owner)).toString()).to.equal(this.block.timestamp.toString())
    await help.expectRevert(this.payout.removeMember(owner, {from: owner}), 'the last member can not be removed')
  })

  it('the owner can remove themself if they are not the only member', async function () {
    await this.payout.addMembers([user1, user2], {from: owner})
    await this.payout.payReward(bn(this.block.timestamp).add(bn(1000)).toString(), {from: owner})
    await this.payout.removeMember(owner, {from: owner})
    expect((await this.payout.members(owner)).toString()).to.equal('0')
    expect((await this.payout.memberCount()).toString()).to.equal('2')
    expect((await this.payout.newMemberCount()).toString()).to.equal('0')
  })

  it('can add new members', async function () {
    const tx = await this.payout.addMembers([user1, user2], {from: owner})
    // initially only the owner is a member
    expect((await this.payout.memberCount()).toString()).to.equal('1')
    expect((await this.payout.newMemberCount()).toString()).to.equal('2')
    const block = await web3.eth.getBlock(tx.receipt.blockNumber)
    expect((await this.payout.members(user1)).toString()).to.be.equal(block.timestamp.toString())
    expect((await this.payout.members(user2)).toString()).to.be.equal(block.timestamp.toString())
    expect((await this.payout.members(user3)).toString()).to.be.equal('0')
  })

  describe('Pay and Pull rewards', function () {
    beforeEach(async function () {
      this.payout = await Payout.new({from: owner})
      this.block = await web3.eth.getBlock('latest')
      await this.payout.setRewardPool(owner)
      this.startTimestamp = Math.floor(Date.now() / 1000)

      await this.payout.addMembers([user1, user2, user3], {from: owner})
      await this.payout.payReward(bn(this.block.timestamp).add(bn(1000)).toString(), {from: owner})
      await this.payout.removeMember(owner, {from: owner})
      this.payoutPeriod = bn(this.block.timestamp).add(bn(2000)).toString()
      const {receipt} = await this.payout.payReward(this.payoutPeriod,
          {from: owner, value: '1000000000000000000'})
      this.gasPrice = bn((await web3.eth.getTransaction(receipt.transactionHash)).gasPrice)
      // fast forward 2001 seconds so that new members are added after the reward
      await help.time.increase('2001')
    })

    it('the last payout period has a positive reward', async function () {
      expect((await this.payout.memberCount()).toString()).to.equal('3')
      const {memberCount, rewardAmount} = await this.payout.rewards(bn(this.block.timestamp).add(bn(2000)).toString())
      expect(memberCount.toString()).to.equal('3')
      expect(rewardAmount.toString()).to.equal('333333333333333333')
    })

    it('existing members can pull their reward only once', async function () {
      const user1Balance = bn(await web3.eth.getBalance(user1))
      const user2Balance = bn(await web3.eth.getBalance(user2))
      const user3Balance = bn(await web3.eth.getBalance(user3))
      {
        const {receipt} = await this.payout.pullReward(this.payoutPeriod, {from: user1})
        expect((await web3.eth.getBalance(user1)).toString()).to
            .equal(user1Balance.sub(this.gasPrice.mul(bn(receipt.gasUsed))).add(bn('333333333333333333')).toString())
        help.expectRevert(this.payout.pullReward(this.payoutPeriod, {from: user1}), "one address can not pull the reward multiple times")
      }
      {
        const {receipt} = await this.payout.pullReward(this.payoutPeriod, {from: user2})
        expect((await web3.eth.getBalance(user2)).toString()).to
            .equal(user2Balance.sub(this.gasPrice.mul(bn(receipt.gasUsed))).add(bn('333333333333333333')).toString())
        help.expectRevert(this.payout.pullReward(this.payoutPeriod, {from: user2}), "one address can not pull the reward multiple times")
      }
      {
        const {receipt} = await this.payout.pullReward(this.payoutPeriod, {from: user3})
        expect((await web3.eth.getBalance(user3)).toString()).to
            .equal(user3Balance.sub(this.gasPrice.mul(bn(receipt.gasUsed))).add(bn('333333333333333333')).toString())
        help.expectRevert(this.payout.pullReward(this.payoutPeriod, {from: user3}), "one address can not pull the reward multiple times")
      }

    })

    it('new members can not pull the reward', async function () {
      await this.payout.addMembers([user4], {from: owner})
      help.expectRevert(this.payout.pullReward(this.payoutPeriod, {from: user4})
          ,'the sender is not eligible for this reward')
    })

    it('new members can pull the next reward', async function () {
      const user4Balance = bn(await web3.eth.getBalance(user4))
      // user4 will be able to get the payout after the next
      await this.payout.addMembers([user4], {from: owner})
      // this payout is still for the 3 members
      await this.payout.payReward(bn(this.payoutPeriod).add(bn(500)), {from: owner, value: '1000000000000000000'})
      const payoutPeriod = bn(this.payoutPeriod).add(bn(1000))
      // this payout is for all 4 members
      await this.payout.payReward(payoutPeriod, {from: owner, value: '1000000000000000000'})
      const {receipt} = await this.payout.pullReward(payoutPeriod, {from: user4})
      expect((await web3.eth.getBalance(user4)).toString()).to
          .equal(user4Balance.sub(this.gasPrice.mul(bn(receipt.gasUsed))).add(bn('250000000000000000')).toString())
    })

  })

})
