import { expect } from 'chai'
import { Contract, BigNumber, constants, utils } from 'ethers'
const { waffle, network, ethers } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;

import { advanceBlocks, evmSnapshot, evmRevert } from './utils'

import CarveToken from '../artifacts/contracts/CarveToken.sol/CarveToken.json'

describe('CarveToken', () => {
    const wallets = provider.getWallets();
    const [owner, bob, carol, tom, rewardpool] = wallets;

    const FEE = 50;
    const name = 'Carve';
    const symbol = 'CARVE';

    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('MINTER_ROLE'));

    let token: Contract;
    let snapshot: string;
    beforeEach(async () => {
      snapshot = await evmSnapshot();

      token = await deployContract(owner, CarveToken, [FEE]);
      await token.setRewardPool(rewardpool.address);
    });

    afterEach(async () => {
      await evmRevert(snapshot);
    });

    describe('token', () => {
      it('has given name', async () => {
        expect(await token.name()).to.eq(name);
      });
      it('has given symbol', async () => {
        expect(await token.symbol()).to.eq(symbol);
      });
      it('has given decimals', async () => {
        expect(await token.decimals()).to.eq(18);
      });
      it('returns the balance', async () => {
        expect(await token.balanceOf(owner.address)).to.eq(0);
      });
      it('returns the fee', async () => {
        expect(await token.fee()).to.eq(FEE);
      });
      it('returns the total supply', async () => {
        expect(await token.totalSupply()).to.eq(0);
      });
      it('returns the cap', async () => {
        expect(await token.CAP()).to.eq(utils.parseEther('100000'));
      });
    });

    describe('reward pool', () => {
      it('can set pool address', async () => {
        await token.setRewardPool(rewardpool.address);
        expect(await token.rewardPoolAddress()).to.be.eq(rewardpool.address);
      });
    });

    describe('mint', () => {
      it('should only allow minter role to mint token', async () => {
        await token.mint(owner.address, '100');
        await token.mint(bob.address, '1000');
        await expect(
            token.connect(bob).mint(carol.address, '1000')
        ).to.be.reverted;
        const totalSupply = await token.totalSupply();
        const ownerBal = await token.balanceOf(owner.address);
        const bobBal = await token.balanceOf(bob.address);
        const carolBal = await token.balanceOf(carol.address);
        expect(ownerBal.valueOf()).to.be.eq('100');
        expect(bobBal.valueOf()).to.be.eq('1000');
        expect(carolBal.valueOf()).to.be.eq('0');
      });
      it('cannot mint more then cap', async () => {
        await expect(
          token.mint(bob.address, utils.parseEther('100001'))
        ).to.be.reverted;
      });
    });

    describe('fee', () => {
      it('should only allow owner to set fee', async () => {
        await token.setFee('10');
        expect((await token.fee()).valueOf()).to.be.eq('10');
        await expect(
            token.connect(carol).setFee('5')
        ).to.be.reverted;
      });
    });

    describe('transfer', () => {
      it('should supply token transfers properly', async () => {
        await token.mint(owner.address, utils.parseEther('1000'));
        await token.mint(bob.address,  utils.parseEther('1000'));


        await token.transfer(carol.address,  utils.parseEther('100'));
        await token.connect(bob).transfer(carol.address,  utils.parseEther('100'));
        const totalSupply = await token.totalSupply();
        const ownerBal = await token.balanceOf(owner.address);
        const bobBal = await token.balanceOf(bob.address);
        const carolBal = await token.balanceOf(carol.address);
        expect(totalSupply.valueOf()).to.be.eq(utils.parseUnits('1995'));
        expect(ownerBal.valueOf()).to.be.eq(utils.parseUnits('900'));
        expect(bobBal.valueOf()).to.be.eq(utils.parseUnits('900'));
        expect(carolBal.valueOf()).to.be.eq(utils.parseUnits('190'));
      });

      it('should fail if you try to do bad transfers', async () => {
        await token.mint(carol.address, '100');
        await expect(
          token.connect(carol).transfer(owner.address, '110')
        ).to.be.reverted;
        await expect(
          token.connect(bob).transfer(carol.address, '1')
        ).to.be.reverted;
      });

      it('should do transferFrom', async () => {
        await token.mint(carol.address, '100');
        expect((await token.totalSupply()).valueOf()).to.be.eq(100);
        expect((await token.balanceOf(carol.address)).valueOf()).to.be.eq(100);
        await token.connect(carol).approve(owner.address, '100')
        await token.transferFrom(carol.address, tom.address, '100');
        expect((await token.balanceOf(carol.address)).valueOf()).to.be.eq(0);
        expect((await token.balanceOf(tom.address)).valueOf()).to.be.eq(95);
        expect((await token.totalSupply()).valueOf()).to.be.eq(97);
      });
    });

    describe('access control', () => {
      it('can add new minter', async () => {
        await expect(
          token.connect(bob).mint(owner.address, utils.parseEther('1000'))
        ).to.be.reverted;
        await token.grantRole(MINTER_ROLE, bob.address);
        await token.connect(bob).mint(owner.address, utils.parseEther('1000'));
      });
      it('can remove minter', async () => {
        await expect(
          token.connect(bob).mint(owner.address, '1000')
        ).to.be.reverted;
        await token.grantRole(MINTER_ROLE, bob.address);
        await token.connect(bob).mint(bob.address, '1000');
        expect(await token.balanceOf(bob.address)).to.eq(1000);
        await token.revokeRole(MINTER_ROLE, bob.address);
        await expect(
          token.connect(bob).mint(owner.address, '1000')
        ).to.be.reverted;
      });
    });

    describe('governance', () => {
      it('nested delegation', async () => {
        await token.mint(owner.address, utils.parseEther('1000'));
        await token.transfer(bob.address, utils.parseEther('1'))
        await token.transfer(carol.address, utils.parseEther('2'))

        const bob_amt_after_burn = utils.parseEther('1').sub(utils.parseEther('0.05'));
        const carol_amt_after_burn = utils.parseEther((2 - 2 * 0.05).toString());

        let currectVotes0 = await token.getCurrentVotes(bob.address)
        let currectVotes1 = await token.getCurrentVotes(carol.address)
        expect(currectVotes0).to.be.eq(0)
        expect(currectVotes1).to.be.eq(0)

        await token.connect(bob).delegate(carol.address)
        currectVotes1 = await token.getCurrentVotes(carol.address)
        expect(currectVotes1).to.be.eq(bob_amt_after_burn)

        await token.connect(carol).delegate(carol.address)
        currectVotes1 = await token.getCurrentVotes(carol.address)
        expect(currectVotes1).to.be.eq(bob_amt_after_burn.add(carol_amt_after_burn))

        await token.connect(carol).delegate(owner.address)
        currectVotes1 = await token.getCurrentVotes(carol.address)
        expect(currectVotes1).to.be.eq(bob_amt_after_burn)
      });

      it('should not have any checkpoint', async () => {
        const bobBal = await token.balanceOf(bob.address)
        expect(bobBal.valueOf()).to.be.eq(0)
        expect((await token.numCheckpoints(bob.address)).valueOf()).to.be.eq(0)
        expect((await token.checkpoints(bob.address, 0)).votes.valueOf()).to.be.eq(0)
      });

      it('should correct delegate', async () => {
        const tomBal = await token.balanceOf(tom.address)
        expect(tomBal.valueOf()).to.be.eq('0')
        expect((await token.numCheckpoints(bob.address)).valueOf()).to.be.eq(0)
        expect((await token.checkpoints(bob.address, 0)).votes.valueOf()).to.be.eq(0)

        await token.mint(owner.address, 50000)

        await token.transfer(tom.address, 100)
        await token.connect(tom).delegate(bob.address)

        expect((await token.numCheckpoints(bob.address)).valueOf()).to.be.eq(1)
        expect((await token.checkpoints(bob.address, 0)).votes.valueOf()).to.be.eq(100 - (100 * FEE / 1000))

        await token.transfer(tom.address, 10)

        expect((await token.numCheckpoints(bob.address)).valueOf()).to.be.eq(2)
        expect((await token.checkpoints(bob.address, 1)).votes.valueOf()).to.be.eq(105)
        expect((await token.getCurrentVotes(bob.address)).valueOf()).to.be.eq(105)

        expect((await token.numCheckpoints(carol.address)).valueOf()).to.be.eq(0)
        expect((await token.checkpoints(carol.address, 0)).votes.valueOf()).to.be.eq(0)
        expect((await token.getCurrentVotes(carol.address)).valueOf()).to.be.eq(0)

        await token.connect(tom).delegate(carol.address)

        expect((await token.checkpoints(bob.address, 1)).votes.valueOf()).to.be.eq(105)

        expect((await token.numCheckpoints(bob.address)).valueOf()).to.be.eq(3)
        expect((await token.checkpoints(bob.address, 2)).votes.valueOf()).to.be.eq(0)
        expect((await token.getCurrentVotes(bob.address)).valueOf()).to.be.eq(0)

        expect((await token.numCheckpoints(carol.address)).valueOf()).to.be.eq(1)
        expect((await token.checkpoints(carol.address, 0)).votes.valueOf()).to.be.eq(105)

        await token.transfer(tom.address, 20)

        expect((await token.numCheckpoints(carol.address)).valueOf()).to.be.eq(2)
        expect((await token.checkpoints(carol.address, 1)).votes.valueOf()).to.be.eq(124)
        expect((await token.getCurrentVotes(carol.address)).valueOf()).to.be.eq(124)

        await token.connect(tom).transfer(owner.address, 20)

        expect((await token.numCheckpoints(carol.address)).valueOf()).to.be.eq(3)
        expect((await token.checkpoints(carol.address, 2)).votes.valueOf()).to.be.eq(104)
        expect((await token.getCurrentVotes(carol.address)).valueOf()).to.be.eq(104)

        await token.mint(tom.address, 5)

        expect((await token.numCheckpoints(carol.address)).valueOf()).to.be.eq(4)
        expect((await token.checkpoints(carol.address, 3)).votes.valueOf()).to.be.eq(109)
        expect((await token.getCurrentVotes(carol.address)).valueOf()).to.be.eq(109)
      });

      it('reverts if block number >= current block', async () => {
        await expect(
          token.getPriorVotes(tom.address, 5e10)
        ).to.be.revertedWith("revert CARVE::getPriorVotes: not yet determined");
      });

      it('returns 0 if there are no checkpoints', async () => {
        expect((await token.getPriorVotes(tom.address, 0))).to.be.eq(0);
      });

      it('returns the latest block if >= last checkpoint block', async () => {
        await token.mint(owner.address, utils.parseEther('1000'));
        await token.connect(owner).delegate(tom.address);
        const t1_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        expect((await token.getPriorVotes(tom.address, t1_block.number))).to.be.eq('1000000000000000000000');
        expect((await token.getPriorVotes(tom.address, t1_block.number + 1))).to.be.eq('1000000000000000000000');
      });

      it('returns zero if < first checkpoint block', async () => {
        await token.mint(owner.address, utils.parseEther('1000'));
        await advanceBlocks(1);
        await token.connect(owner).delegate(tom.address);
        const t1_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        expect((await token.getPriorVotes(tom.address, t1_block.number - 1))).to.be.eq('0');
        expect((await token.getPriorVotes(tom.address, t1_block.number + 1))).to.be.eq('1000000000000000000000');
      });

      it('generally returns the voting balance at the appropriate checkpoint', async () => {
        await token.mint(owner.address, utils.parseEther('1000'));
        await token.connect(owner).delegate(bob.address);
        const t1_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        await token.transfer(carol.address, 10);
        const t2_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        await token.transfer(carol.address, 10)
        const t3_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        await token.connect(carol).transfer(owner.address, 20)
        const t4_block = await provider.getBlock("latest");
        await advanceBlocks(2);

        expect((await token.getPriorVotes(bob.address, t1_block.number - 1))).to.be.eq('0');
        expect((await token.getPriorVotes(bob.address, t1_block.number))).to.be.eq('1000000000000000000000');
        expect((await token.getPriorVotes(bob.address, t1_block.number + 1))).to.be.eq('1000000000000000000000');
        expect((await token.getPriorVotes(bob.address, t2_block.number))).to.be.eq('999999999999999999990');
        expect((await token.getPriorVotes(bob.address, t2_block.number + 1))).to.be.eq('999999999999999999990');
        expect((await token.getPriorVotes(bob.address, t3_block.number))).to.be.eq('999999999999999999980');
        expect((await token.getPriorVotes(bob.address, t3_block.number + 1))).to.be.eq('999999999999999999980');
        expect((await token.getPriorVotes(bob.address, t4_block.number))).to.be.eq('999999999999999999999');
        expect((await token.getPriorVotes(bob.address, t4_block.number + 1))).to.be.eq('999999999999999999999');
      });
    })
});