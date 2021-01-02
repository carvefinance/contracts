import { expect } from 'chai';
import { Contract, BigNumber, constants, utils, providers } from 'ethers';
const { waffle, network, ethers } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;

import { advanceBlockAndTime, duration } from './utils';

import CarvePresale from '../artifacts/contracts/CarvePresale.sol/CarvePresale.json';
import CarveToken from '../artifacts/contracts/CarveToken.sol/CarveToken.json';

describe('CarvePresale', () => {

  const wallets = provider.getWallets();
  const [alice, bob, carol, dev, minter] = wallets;
  let carve: Contract;
  let presale: Contract;

  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('MINTER_ROLE'));

  const FEE = 0;
  const PRE_SALE_START = BigNumber.from(Date.now()).add(duration.seconds('60'));

  beforeEach(async () => {
    carve = await deployContract(alice, CarveToken, [FEE]);
    presale = await deployContract(alice, CarvePresale, [carve.address, PRE_SALE_START, dev.address]);
    await carve.grantRole(MINTER_ROLE, presale.address);
  });

  describe('presale parameters', () => {
    it('has given start time', async () => {
      expect(await presale.PRESALE_START_TIME()).to.eq(PRE_SALE_START);
    });
    it('has given token price', async () => {
      expect(await presale.PRICE_PER_TOKEN()).to.eq('1');
    });
    it('has given max eth per wallet', async () => {
      expect(await presale.MAX_ETH_PER_WALLET()).to.eq(utils.parseEther('5'));
    });
    it('has given cap', async () => {
      expect(await presale.PRESALE_CAP()).to.eq(utils.parseEther('25000'));
    });
    it('has given max token per wallet', async () => {
      expect(await presale.MAX_TOKEN_PER_WALLET()).to.eq(utils.parseEther('500'));
    });
    it('has correct remaining supply', async () => {
      expect(await presale.remainingSupply()).to.eq(utils.parseEther('25000'));
    });
    it('not finalized at start', async () => {
      expect(await presale.preSaleComplete()).to.eq(false);
    });
  });

  describe('presale', () => {
    it('should not allow buy until presale starts', async () => {
      await expect(
        alice.sendTransaction({
          to: presale.address,
          value: ethers.utils.parseEther('1')
        })
      ).to.be.revertedWith('presale-not-started');
    });

    it('can buy after presale starts', async () => {
      await advanceBlockAndTime(PRE_SALE_START.add(10).toNumber());

      await alice.sendTransaction({
        to: presale.address,
        value: ethers.utils.parseEther('1')
      });

      await bob.sendTransaction({
        to: presale.address,
        value: ethers.utils.parseEther('3')
      });

      expect(await presale.userBalances(bob.address)).to.eq(utils.parseEther('300'));

      await expect(
        alice.sendTransaction({
          to: presale.address,
          value: ethers.utils.parseEther('6')
        })
      ).to.be.revertedWith('max-per-wallet-hit');
    });

    it('can finalize and claim', async () => {
      await advanceBlockAndTime(PRE_SALE_START.add(10).toNumber());

      await alice.sendTransaction({
        to: presale.address,
        value: ethers.utils.parseEther('4')
      });

      expect(await presale.userBalances(alice.address)).to.eq(utils.parseEther('400'));
      expect(await presale.remainingSupply()).to.eq(utils.parseEther('24600'));

      await bob.sendTransaction({
        to: presale.address,
        value: ethers.utils.parseEther('5')
      });

      expect(await presale.userBalances(bob.address)).to.eq(utils.parseEther('500'));
      expect(await presale.remainingSupply()).to.eq(utils.parseEther('24100'));

      await carol.sendTransaction({
        to: presale.address,
        value: ethers.utils.parseEther('5')
      });

      expect(await presale.userBalances(carol.address)).to.eq(utils.parseEther('500'));
      expect(await presale.remainingSupply()).to.eq(utils.parseEther('23600'));

      await presale.finalize();
      expect(await presale.preSaleComplete()).to.eq(true);

      await presale.claim();
      await presale.connect(bob).claim();
      await presale.connect(carol).claim();

      expect(await dev.getBalance()).to.eq(utils.parseEther('10001.4'));

      expect(await carve.balanceOf(alice.address)).to.eq(utils.parseEther('400'));
      expect(await carve.balanceOf(bob.address)).to.eq(utils.parseEther('500'));
      expect(await carve.balanceOf(carol.address)).to.eq(utils.parseEther('500'));
    });
  });
});