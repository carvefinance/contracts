import { expect } from 'chai';
import { Contract, BigNumber, constants, utils, providers } from 'ethers';
const { waffle, network, ethers } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;

import CarveStaking from '../artifacts/contracts/CarveStaking.sol/CarveStaking.json';
import CarveToken from '../artifacts/contracts/CarveToken.sol/CarveToken.json';

describe('CarveStaking', () => {

  const wallets = provider.getWallets();
  const [alice, bob, carol, dev, minter] = wallets;
  let carve: Contract;
  let staking: Contract;

  const FEE = 0;

  beforeEach(async () => {
    carve = await deployContract(alice, CarveToken, [FEE]);
    staking = await deployContract(alice, CarveStaking, [carve.address]);
    await carve.mint(alice.address, '100');
    await carve.mint(bob.address, '100');
    await carve.mint(carol.address, '100');
  });

  it('should not allow stake if not enough approve', async () => {
    await expect(
      staking.stake('100')
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await carve.approve(staking.address, '50');
    await expect(
      staking.stake('100')
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

    await carve.approve(staking.address, '100');
    await staking.stake('100');
    expect((await staking.balanceOf(alice.address)).valueOf()).to.eq(100);
  });

  it('should not allow withdraw more than what you have', async () => {
    await carve.approve(staking.address, '100');
    await staking.stake('100');
    await expect(
      staking.unstake('200')
    ).to.be.revertedWith("ERC20: burn amount exceeds balance");
  });

  it('should work with more than one participant', async () => {
    await carve.approve(staking.address, '100');
    await carve.connect(bob).approve(staking.address, '100');
    // Alice stakes and gets 20 shares. Bob stakes and gets 10 shares.
    await staking.stake('20');
    await staking.connect(bob).stake('10');
    expect((await staking.balanceOf(alice.address)).valueOf()).to.eq(20);
    expect((await staking.balanceOf(bob.address)).valueOf()).to.eq(10);
    expect((await carve.balanceOf(staking.address)).valueOf()).to.eq(30);

    // CarveStaking get 20 more CARVEs from an external source.
    await carve.connect(carol).transfer(staking.address, '20');
    // Alice deposits 10 more CARVEs. She should receive 10*30/50 = 6 shares.
    await staking.stake('10');
    expect((await staking.balanceOf(alice.address)).valueOf()).to.eq(26);
    expect((await staking.balanceOf(bob.address)).valueOf()).to.eq(10);
    // Bob withdraws 5 shares. He should receive 5*60/36 = 8 shares
    await staking.connect(bob).unstake('5');
    expect((await staking.balanceOf(alice.address)).valueOf()).to.eq(26);
    expect((await staking.balanceOf(bob.address)).valueOf()).to.eq(5);
    expect((await carve.balanceOf(staking.address)).valueOf()).to.eq(52);
    expect((await carve.balanceOf(alice.address)).valueOf()).to.eq(70);
    expect((await carve.balanceOf(bob.address)).valueOf()).to.eq(98);
  });

  it('exit should work', async () => {
    await carve.approve(staking.address, '100');
    await staking.stake('100');
    await staking.exit();
  });
});