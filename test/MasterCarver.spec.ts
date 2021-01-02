import { expect } from 'chai'
import { Contract, BigNumber, constants, utils } from 'ethers'
const { waffle, network, ethers } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;

import { advanceBlockTo, evmSnapshot, evmRevert, latestBlockTimestamp } from './utils'

import CarveToken from '../artifacts/contracts/CarveToken.sol/CarveToken.json'
import MasterCarver from '../artifacts/contracts/MasterCarver.sol/MasterCarver.json'
import MockERC20 from '../artifacts/contracts/test/MockERC20.sol/MockERC20.json'

describe('MasterCarver', () => {

  const wallets = provider.getWallets();
  const [alice, bob, carol, dev, minter, rewardpool] = wallets;
  let carve: Contract;

  const FEE = 50;
  const ZERO_ADDRESS = ethers.constants.AddressZero;

  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('MINTER_ROLE'));

  let snapshot: string;
  beforeEach(async () => {
    snapshot = await evmSnapshot();

    carve = await deployContract(alice, CarveToken, [FEE]);
  });

  afterEach(async () => {
    await evmRevert(snapshot);
  })

  it('should set correct state variables', async () => {
    const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '1000', '0']);
    const token = await masterCarver.carve();
    const devaddr = await masterCarver.treasuryAddress();
    expect(token.valueOf()).to.eq(carve.address);
    expect(devaddr.valueOf()).to.eq(dev.address);
  });

  it('should allow dev and only dev to update dev', async () => {
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '1000', '0']);
      expect((await masterCarver.treasuryAddress()).valueOf(), dev.address);
      await expect(
        masterCarver.connect(bob).updateTreasuryAddress(bob.address)
      ).to.be.reverted;
      await masterCarver.connect(dev).updateTreasuryAddress(bob.address);
      expect((await masterCarver.treasuryAddress()).valueOf()).to.eq(bob.address);
      await masterCarver.connect(bob).updateTreasuryAddress(alice.address);
      expect((await masterCarver.treasuryAddress()).valueOf()).to.eq(alice.address);
  })

  describe('With ERC/LP token added to the field', () => {
    let lp: Contract;
    let lp2: Contract;
    let snapshot2: string;

    beforeEach(async () => {

      snapshot2 = await evmSnapshot();

      carve = await deployContract(alice, CarveToken, [FEE]);
      lp = await deployContract(minter, MockERC20, ['LPToken', 'LP', utils.parseEther('10000000')]);
      await lp.transfer(alice.address, '1000', { from: minter.address });
      await lp.transfer(bob.address, '1000', { from: minter.address });
      await lp.transfer(carol.address, '1000', { from: minter.address });
      lp2 = await deployContract(minter, MockERC20, ['LPToken2', 'LP2', utils.parseEther('10000000')]);
      await lp2.transfer(alice.address, '1000', { from: minter.address });
      await lp2.transfer(bob.address, '1000', { from: minter.address });
      await lp2.transfer(carol.address, '1000', { from: minter.address });
    });

    afterEach(async () => {
      await evmRevert(snapshot2);
    })

    it('should allow emergency withdraw', async () => {
      // 100 per block farming rate starting at block 100
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '100']);
      await masterCarver.setRewardPoolFee('0');
      await masterCarver.add('100', lp.address, 0);
      await lp.connect(bob).approve(masterCarver.address, '1000');
      await masterCarver.connect(bob).deposit(0, '100', carol.address, 0);
      expect((await lp.balanceOf(bob.address)).valueOf()).to.eq(900);
      await masterCarver.connect(bob).emergencyWithdraw(0);
      expect((await lp.balanceOf(bob.address)).valueOf()).to.eq(1000);
    });

    it('cannot add non-ERC20 tokens or duplicates', async () => {
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '100']);
      await expect(
        masterCarver.add('100', masterCarver.address, 0)
      ).to.be.reverted;
      await masterCarver.add('100', lp.address, 0);
      await expect(
        masterCarver.add('100', lp.address, 0)
      ).to.be.reverted;
    });

    it('should give out CARVE only after farming time', async () => {
      // 100 per block farming rate starting at block 100
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '110']);
      await masterCarver.setRewardPoolFee('0');
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await masterCarver.add('100', lp.address, 0);
      await lp.connect(bob).approve(masterCarver.address, '1000');
      await expect(
        masterCarver.connect(bob).deposit(0, '100', bob.address, 0)
      ).to.be.reverted;
      await masterCarver.connect(bob).deposit(0, '100', ZERO_ADDRESS, 0);
      await advanceBlockTo(97);
      await masterCarver.connect(bob).deposit(0, '0', ZERO_ADDRESS, 0); // block 98
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(0);
      await advanceBlockTo(99);
      await masterCarver.connect(bob).deposit(0, '0', ZERO_ADDRESS, 0); // block 100
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(0);
      await advanceBlockTo(100);
      await masterCarver.connect(bob).deposit(0, '0', ZERO_ADDRESS, 0); // block 101
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(0);
      await advanceBlockTo(110);
      await masterCarver.connect(bob).deposit(0, '0', ZERO_ADDRESS, 0); // block 111
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(100 * ((1000-FEE)/1000));
      await advanceBlockTo(114);
      await masterCarver.connect(bob).deposit(0, '0', ZERO_ADDRESS, 0); // block 115
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(500 * ((1000-FEE)/1000));
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(50);
      expect((await carve.totalSupply()).valueOf()).to.eq(550 - (await carve.burnedSupply()).valueOf());
    });

    it('should not distribute CARVE if no one deposit', async () => {
      // 100 per block farming rate starting at block 200
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '200']);
      await masterCarver.setRewardPoolFee('0');
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await masterCarver.add('100', lp.address, 0);
      await lp.connect(bob).approve(masterCarver.address, '1000');
      await advanceBlockTo(199);
      expect((await carve.totalSupply()).valueOf()).to.eq(0);
      await advanceBlockTo(204);
      expect((await carve.totalSupply()).valueOf()).to.eq(0);
      await advanceBlockTo(209);
      await masterCarver.connect(bob).deposit(0, '10', ZERO_ADDRESS, 0); // block 210
      expect((await carve.totalSupply()).valueOf()).to.eq(0);
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(0);
      expect((await lp.balanceOf(bob.address)).valueOf()).to.eq(990);
      await advanceBlockTo(219);
      await masterCarver.connect(bob).withdraw(0, '10', 0); // block 220
      expect((await carve.totalSupply()).valueOf()).to.eq(1050);
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(1000 * ((1000-FEE)/1000));
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(100);
      expect((await lp.balanceOf(bob.address)).valueOf()).to.eq(1000);
    });

    it('should distribute CARVE properly for each staker', async () => {
      // 100 per block farming rate starting at block 300
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '300']);
      await masterCarver.setRewardPoolFee('0');
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await masterCarver.add('100', lp.address, 0);
      await lp.connect(alice).approve(masterCarver.address, '1000');
      await lp.connect(bob).approve(masterCarver.address, '1000');
      await lp.connect(carol).approve(masterCarver.address, '1000');
      // Alice deposits 10 LPs at block 310
      await advanceBlockTo(309);
      await masterCarver.connect(alice).deposit(0, '10', ZERO_ADDRESS, 0);
      // Bob deposits 20 LPs at block 314
      await advanceBlockTo(313);
      await masterCarver.connect(bob).deposit(0, '20', ZERO_ADDRESS, 0);
      // Carol deposits 30 LPs at block 318
      await advanceBlockTo(317);
      await masterCarver.connect(carol).deposit(0, '30', ZERO_ADDRESS, 0);
      // Alice deposits 10 more LPs at block 320. At this point:
      //   Alice should have: 4*100 + 4*1/3*100 + 2*1/6*100 = 566
      //   MasterCarver should have the remaining: 1000 - 566 = 433
      await advanceBlockTo(319);
      await masterCarver.connect(alice).deposit(0, '10', ZERO_ADDRESS, 0);
      expect((await carve.totalSupply()).valueOf()).to.eq(1100);
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(566);
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(carol.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(masterCarver.address)).valueOf()).to.eq(434);
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(100);

      // Bob withdraws 5 LPs at block 330. At this point:
      //   Bob should have: 4*2/3*100 + 2*2/6*100 + 10*2/7*1000 = 619
      await advanceBlockTo(329);
      await masterCarver.connect(bob).withdraw(0, '5', 0);
      expect((await carve.totalSupply()).valueOf()).to.eq(2200);
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(566);
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(619);
      expect((await carve.balanceOf(carol.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(masterCarver.address)).valueOf()).to.eq(815);
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(200);

      // Alice withdraws 20 LPs at block 340.
      // Bob withdraws 15 LPs at block 350.
      // Carol withdraws 30 LPs at block 360.
      await advanceBlockTo( 339);
      await masterCarver.connect(alice).withdraw(0, '20', 0);
      await advanceBlockTo(349);
      await masterCarver.connect(bob).withdraw(0, '15', 0);
      await advanceBlockTo(359);
      await masterCarver.connect(carol).withdraw(0, '30', 0);
      expect((await carve.totalSupply()).valueOf()).to.eq(5500);
      expect((await carve.balanceOf(dev.address)).valueOf()).to.eq(500);
      // Alice should have: 566 + 10*2/7*100 + 10*2/6.5*100 = 1159
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(1159);
      // Bob should have: 619 + 10*1.5/6.5 * 100 + 10*1.5/4.5*100 = 1183
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(1183);
      // Carol should have: 2*3/6*100 + 10*3/7*100 + 10*3/6.5*100 + 10*3/4.5*100 + 10*100 = 2657
      expect((await carve.balanceOf(carol.address)).valueOf()).to.eq(2657);
      // All of them should have 1000 LPs back.
      expect((await lp.balanceOf(alice.address)).valueOf()).to.eq(1000);
      expect((await lp.balanceOf(bob.address)).valueOf()).to.eq(1000);
      expect((await lp.balanceOf(carol.address)).valueOf()).to.eq(1000);
    });

    it('should give proper CARVE allocation to each pool', async () => {
      // 100 per block farming rate starting at block 400
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '400']);
      await masterCarver.setRewardPoolFee('0');
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await lp.connect(alice).approve(masterCarver.address, '1000');
      await lp2.connect(bob).approve(masterCarver.address, '1000');
      // Add first LP to the pool with allocation 1
      await masterCarver.add('10', lp.address, 0);
      // Alice deposits 10 LPs at block 410
      await advanceBlockTo(409);
      await masterCarver.connect(alice).deposit(0, '10', ZERO_ADDRESS, 0);
      // Add LP2 to the pool with allocation 2 at block 420
      await advanceBlockTo(419);
      await masterCarver.add('20', lp2.address, 0);
      // Alice should have 10*100 pending reward
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(1000);
      // Bob deposits 10 LP2s at block 425
      await advanceBlockTo(424);
      await masterCarver.connect(bob).deposit(1, '5', ZERO_ADDRESS, 0);
      // Alice should have 1000 + 5*1/3*100 = 1166 pending reward
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(1166);
      await advanceBlockTo(430);
      // At block 430. Bob should get 5*2/3*100 = 333. Alice should get ~1666 more.
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(1333);
      expect((await masterCarver.pendingCarve(1, bob.address)).valueOf()).to.eq(333);
    });

    it('should handle claim fees correctly', async () => {
      // 100 per block farming rate starting at block 200
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '600']);
      await masterCarver.setRewardPoolFee('50');
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await lp.connect(alice).approve(masterCarver.address, '1000');
      await lp2.connect(bob).approve(masterCarver.address, '1000');
      // Add first LP to the pool with allocation 1
      await masterCarver.add('10', lp.address, 0);
      // Alice deposits 10 LPs at block 650
      await advanceBlockTo(649);
      await masterCarver.connect(alice).deposit(0, '10', ZERO_ADDRESS, 0);
      await advanceBlockTo(705);
      // At block 705, she should have 100*55 = 5500 pending.
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(5500);
      await masterCarver.connect(alice).claim(0, 0);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(0);
      // At block 706, she should have 100*56 = 5600 - 5% for reward pool fee = 5320.
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(5320);
    });

    it('should give proper CARVE allocation to each pool (extended)', async () => {
      // 100 per block farming rate starting at block 400
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '100', '800']);
      await masterCarver.setRewardPoolFee('0');
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await lp.connect(alice).approve(masterCarver.address, '1000');
      await lp2.connect(bob).approve(masterCarver.address, '1000');

      await advanceBlockTo(796);
      await masterCarver.add('10', lp.address, 0);
      await masterCarver.add('90', lp2.address, 0);
      await masterCarver.connect(alice).deposit(0, '10', ZERO_ADDRESS, 0);
      await masterCarver.connect(bob).deposit(1, '10', ZERO_ADDRESS, 0);
      await advanceBlockTo(801);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(10);
      expect((await masterCarver.pendingCarve(1, bob.address)).valueOf()).to.eq(90);
    });

    it('should handle cap correctly', async () => {
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, utils.parseEther('10000'), '900']);
      await masterCarver.setRewardPoolFee('0');
      await lp.transfer(alice.address, utils.parseEther('10'), { from: minter.address });
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await lp.connect(alice).approve(masterCarver.address, utils.parseEther('10'));
      await masterCarver.add('100', lp.address, 0);
      await advanceBlockTo(899);
      await masterCarver.connect(alice).deposit(0, utils.parseEther('10'), ZERO_ADDRESS, 0);
      await advanceBlockTo(1000);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(utils.parseEther('1000000'));
      await advanceBlockTo(1001);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(utils.parseEther('1010000'));
      await masterCarver.connect(alice).claim(0, 0);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(utils.parseEther('100000'));
    });

    it('should handle referrals correctly', async () => {
      const masterCarver = await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, utils.parseEther('100'), '900']);
      await masterCarver.setRewardPoolFee('0');
      await lp.transfer(alice.address, utils.parseEther('10'), { from: minter.address });
      await carve.setFee(0);
      await carve.grantRole(MINTER_ROLE, masterCarver.address);
      await lp.connect(alice).approve(masterCarver.address, utils.parseEther('10'));
      await masterCarver.add('100', lp.address, 0);
      await advanceBlockTo(1099);
      await masterCarver.connect(alice).deposit(0, utils.parseEther('10'), bob.address, 0);
      await advanceBlockTo(1200);
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(utils.parseEther('0'));
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(utils.parseEther('0'));
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(utils.parseEther('10000'));
      await masterCarver.connect(alice).claim(0, 0);
      expect((await masterCarver.pendingCarve(0, alice.address)).valueOf()).to.eq(0);
      expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(utils.parseEther('9999'));
      expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(utils.parseEther('101'));
    });
  });
});