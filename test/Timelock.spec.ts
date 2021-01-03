import { expect } from 'chai';
import { Contract, BigNumber, constants, utils, providers } from 'ethers';
const { waffle, network, ethers } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;

import { advanceBlockAndTime, duration, latestBlockTimestamp, evmSnapshot, evmRevert } from './utils';

import CarveToken from '../artifacts/contracts/CarveToken.sol/CarveToken.json';
import MasterCarver from '../artifacts/contracts/MasterCarver.sol/MasterCarver.json';
import Timelock from '../artifacts/contracts/governance/Timelock.sol/Timelock.json';
import MockERC20 from '../artifacts/contracts/test/MockERC20.sol/MockERC20.json';

function encodeParameters(types: any, values: any) {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
}

describe('Timelock', () => {

  const wallets = provider.getWallets();
  const [alice, bob, carol, dev, minter, rewardpool] = wallets;
  let carve: Contract;
  let timelock: Contract;
  let snapshot: string;

  const FEE = 0;
  const ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const GOV_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('GOV_ROLE'));
  const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('MINTER_ROLE'));

  beforeEach(async () => {
    snapshot = await evmSnapshot();
    carve = await deployContract(alice, CarveToken, [FEE]);
    timelock = await deployContract(alice, Timelock, [bob.address, 259200]);
  });

  afterEach(async () => {
    await evmRevert(snapshot);
  })

  it('should not allow non-owner to do operation', async () => {
    await carve.grantRole(ADMIN_ROLE, timelock.address);
    await carve.revokeRole(ADMIN_ROLE, alice.address);

    await expect(
      carve.connect(alice).grantRole(ADMIN_ROLE, carol.address)
    ).to.be.revertedWith("AccessControl: sender must be an admin to grant");

    await expect(
      carve.connect(bob).grantRole(ADMIN_ROLE, carol.address)
    ).to.be.revertedWith("AccessControl: sender must be an admin to grant");

    await expect(
      timelock.connect(alice).queueTransaction(
        carve.address, '0', 'grantRole(role,address)',
        encodeParameters(['bytes32', 'address'], [ADMIN_ROLE, carol.address]),
        (await latestBlockTimestamp()).add(duration.days(4))
      )
    ).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.");
  });

  it('should do the timelock thing', async () => {
    await carve.grantRole(ADMIN_ROLE, timelock.address);
    await carve.grantRole(GOV_ROLE, timelock.address);
    await carve.revokeRole(ADMIN_ROLE, alice.address);

    const eta = (await latestBlockTimestamp()).add(duration.days(4));
    await timelock.connect(bob).queueTransaction(
        carve.address, '0', 'grantRole(bytes32,address)',
        encodeParameters(['bytes32', 'address'], [ADMIN_ROLE, carol.address]), eta
    );

    await advanceBlockAndTime(duration.days(1).toNumber());
    await expect(
        timelock.connect(bob).executeTransaction(
            carve.address, '0', 'grantRole(bytes32,address)',
            encodeParameters(['bytes32', 'address'], [ADMIN_ROLE, carol.address]), eta
        )
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");

    await advanceBlockAndTime(duration.days(4).toNumber());
    await timelock.connect(bob).executeTransaction(
        carve.address, '0', 'grantRole(bytes32,address)',
        encodeParameters(['bytes32', 'address'], [ADMIN_ROLE, carol.address]), eta
    );

    expect(await carve.hasRole(ADMIN_ROLE, carol.address)).to.eq(true);
  });

  it('should also work with MasterCarver', async () => {
    let lp1: Contract = await deployContract(minter, MockERC20, ['LPToken1', 'LP1', '10000000000']);
    let lp2: Contract = await deployContract(minter, MockERC20, ['LPToken2', 'LP2', '10000000000']);
    let masterCarver: Contract =  await deployContract(alice, MasterCarver, [carve.address, rewardpool.address, dev.address, '1000', '0']);

    await carve.grantRole(MINTER_ROLE, masterCarver.address);
    await masterCarver.add('0', lp1.address, '0');
    await masterCarver.transferOwnership(timelock.address);
    const eta = (await latestBlockTimestamp()).add(duration.days(4));
    await timelock.connect(bob).queueTransaction(
        masterCarver.address, '0', 'set(uint256,uint256,uint8)',
        encodeParameters(['uint256', 'uint256', 'uint8'], ['0', '200', '0']), eta
    );
    await timelock.connect(bob).queueTransaction(
        masterCarver.address, '0', 'add(uint256,address,uint8)',
        encodeParameters(['uint256', 'address', 'uint8'], ['100', lp2.address, '0']), eta
    );

    await advanceBlockAndTime(duration.days(4).toNumber());
    await timelock.connect(bob).executeTransaction(
        masterCarver.address, '0', 'set(uint256,uint256,uint8)',
        encodeParameters(['uint256', 'uint256', 'uint8'], ['0', '200', '0']), eta
    );
    await timelock.connect(bob).executeTransaction(
        masterCarver.address, '0', 'add(uint256,address,uint8)',
        encodeParameters(['uint256', 'address', 'uint8'], ['100', lp2.address, '0']), eta
    );

    expect((await masterCarver.poolInfo('0')).valueOf().allocPoint).to.eq(200);
    expect((await masterCarver.totalAllocPoint()).valueOf()).to.eq(300);
    expect((await masterCarver.poolLength()).valueOf()).to.eq(2);
  });
});