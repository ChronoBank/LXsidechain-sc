const Rewards = artifacts.require("Rewards")
const TimeHolder = artifacts.require("TimeHolder")
const FakeCoin = artifacts.require("FakeCoin")
const ChronoBankPlatform = artifacts.require("ChronoBankPlatform")
const ChronoBankAssetProxy = artifacts.require("ChronoBankAssetProxy")
const MultiEventsHistory = artifacts.require("MultiEventsHistory")

const Reverter = require('./helpers/reverter')
const utils = require("./helpers/utils")
const eventsHelper = require('./helpers/eventsHelper')
const ErrorsEnum = require("../common/errors")

contract('New version of TimeHolder', (accounts) => {
    let reverter = new Reverter(web3);

    let reward;
    let timeHolder;
    let timeHolderWallet
    let shares;
    let asset1;
    let asset2;

    let miner = accounts[9]

    const ZERO_INTERVAL = 0;
    const SHARES_BALANCE = 100000000;
    const UINT_MAX = web3.toBigNumber(2).pow(256).sub(1)

    let _withdrawShares = async (sender, amount) => {
        await timeHolder.withdrawShares(shares.address, amount, { from: sender, })
    }

    let _withdrawSharesCall = async (sender, amount) => {
        return await timeHolder.withdrawShares.call(shares.address, amount, { from: sender, })
    }

    before('Setup', async() => {
        await reverter.promisifySnapshot();

        reward = await Rewards.deployed()
        timeHolder = await TimeHolder.deployed()

        timeHolderWallet = await timeHolder.wallet()

        let platform = await ChronoBankPlatform.deployed()
        shares = ChronoBankAssetProxy.at(await platform.proxies("TIME"))

        await platform.reissueAsset(await shares.symbol(), 3 * SHARES_BALANCE)
        await shares.transfer(accounts[1], SHARES_BALANCE);
        await shares.transfer(accounts[2], SHARES_BALANCE);

        await shares.approve(timeHolderWallet, SHARES_BALANCE, {from: accounts[0]})
        await shares.approve(timeHolderWallet, SHARES_BALANCE, {from: accounts[1]})
        await shares.approve(timeHolderWallet, SHARES_BALANCE, {from: accounts[2]})

        asset1 = await FakeCoin.new("FAKE2", "FAKE2", 4);
        asset2 = await FakeCoin.new("FAKE3", "FAKE3", 4);

        await asset1.mint(accounts[0], SHARES_BALANCE);
        await asset1.mint(accounts[1], SHARES_BALANCE);

        await asset2.mint(accounts[0], SHARES_BALANCE);
        await asset2.mint(accounts[1], SHARES_BALANCE);

        await reverter.promisifySnapshot();
    });

    after(async () => {
        await reverter.promisifyRevert(1);
    })

    context("initial state", () => {
        const DEPOSIT_AMOUNT = 100

        describe("without primary miner", () => {
            it("should NOT allow to make a deposit with TIMEHOLDER_MINER_REQUIRED code", async () => {
                await timeHolder.setPrimaryMiner(0x0, { from: accounts[0], })
                let result = await timeHolder.deposit.call(shares.address, DEPOSIT_AMOUNT, { from: accounts[0],})
                assert.equal(result, ErrorsEnum.TIMEHOLDER_MINER_REQUIRED)
            })
        })

        describe("with updating primary miner", () => {

            after('revert', reverter.revert);

            it("should NOT allow to set a primary miner by non contract owner with UNAUTHORIZED code", async () => {
                const stranger = accounts[5]
                assert.equal(
                    (await timeHolder.setPrimaryMiner.call(accounts[1], { from: stranger, })).toNumber(),
                    ErrorsEnum.UNAUTHORIZED
                )
            })

            it("should allow to set a primary miner by contract owner with OK code", async () => {
                assert.equal(
                    (await timeHolder.setPrimaryMiner.call(accounts[9], { from: accounts[0], })).toNumber(),
                    ErrorsEnum.OK
                )
            })

            it("should allow to set a primary miner by contract owner", async () => {
                const previousMiner = await timeHolder.getPrimaryMiner.call()
                const newMiner = accounts[9]
                await timeHolder.setPrimaryMiner(newMiner, { from: accounts[0], })
                assert.notEqual(await timeHolder.getPrimaryMiner.call(), previousMiner)
                assert.equal(await timeHolder.getPrimaryMiner.call(), newMiner)
            })

            it("should emit 'PrimaryMinerChanged' event when updating primary miner", async () => {
                const previousMiner = await timeHolder.getPrimaryMiner.call()
                const newMiner = accounts[7]
                const eventTx = await timeHolder.setPrimaryMiner(newMiner, { from: accounts[0], })
                const event = (await eventsHelper.findEvent([timeHolder,], eventTx, "PrimaryMinerChanged"))[0]
                assert.isDefined(event)
                assert.equal(event.address, MultiEventsHistory.address)
                assert.equal(event.name, 'PrimaryMinerChanged');
                assert.equal(event.args.from, previousMiner)
                assert.equal(event.args.to, newMiner)
            })
        })

        describe("with presetup primary miner", () => {
            before(async () => {
                await timeHolder.setPrimaryMiner(miner)
            })

            after('revert', reverter.revert);

            it("should THROW and NOT allow to deposit to the address == primaryMiner", async () => {
                await timeHolder.depositFor.call(shares.address, miner, DEPOSIT_AMOUNT, { from: accounts[0], })
                .then(assert.fail, () => true)
            })

            it("should allow to deposit", async () => {
                assert.equal(
                    (await timeHolder.deposit.call(shares.address, DEPOSIT_AMOUNT, { from: accounts[0], })).toNumber(),
                    ErrorsEnum.OK
                )
            })
        })

        describe("with default mining deposit limit", () => {
            it("should be equal to 0", async () => {
                assert.equal(
                    (await timeHolder.getMiningDepositLimits.call(shares.address)).toNumber(),
                    '0'
                )
            })
        })
    })

    context("main functionality as", () => {

        before(async () => {
            await timeHolder.setPrimaryMiner(miner)
            await reverter.promisifySnapshot();
        })

        context("deposit", function () {
            afterEach('revert', reverter.revert);

            it('should correct handle default shares', async () => {
                const DEPOSIT_AMOUNT = 200;

                assert.equal((await timeHolder.deposit.call(shares.address, DEPOSIT_AMOUNT, { from: accounts[0], })).toNumber(), ErrorsEnum.OK);
                await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: accounts[0], });

                assert.equal(await timeHolder.getDepositBalance(shares.address, accounts[0]), DEPOSIT_AMOUNT);
                assert.equal(await timeHolder.depositBalance(accounts[0]), DEPOSIT_AMOUNT);
            });

            it('shouldn\'t allow blacklisted assest', async () => {
                const DEPOSIT_AMOUNT1 = 200;
                const DEPOSIT_AMOUNT2 = 201;

                assert.equal(await timeHolder.getDepositBalance(asset1.address, accounts[0]), 0);
                assert.equal(await timeHolder.getDepositBalance(asset2.address, accounts[0]), 0);

                assert.equal(await timeHolder.deposit.call(asset1.address, DEPOSIT_AMOUNT1), ErrorsEnum.UNAUTHORIZED);
                assert.equal(await timeHolder.deposit.call(asset2.address, DEPOSIT_AMOUNT2), ErrorsEnum.UNAUTHORIZED);

                await timeHolder.deposit(asset1.address, DEPOSIT_AMOUNT1);
                await timeHolder.deposit(asset2.address, DEPOSIT_AMOUNT2);

                assert.equal(await timeHolder.getDepositBalance(asset1.address, accounts[0]), 0);
                assert.equal(await timeHolder.getDepositBalance(asset2.address, accounts[0]), 0);
            });

            it('should permit whitelisted assests', async () => {
                const DEPOSIT_AMOUNT1 = 200;
                const DEPOSIT_AMOUNT2 = 201;

                await timeHolder.allowShares([asset1.address, asset2.address], [SHARES_BALANCE, SHARES_BALANCE]);

                assert.equal(await timeHolder.getDepositBalance(asset1.address, accounts[0]), 0);
                assert.equal(await timeHolder.getDepositBalance(asset2.address, accounts[0]), 0);

                assert.equal(await timeHolder.deposit.call(asset1.address, DEPOSIT_AMOUNT1), ErrorsEnum.OK);
                assert.equal(await timeHolder.deposit.call(asset2.address, DEPOSIT_AMOUNT2), ErrorsEnum.OK);

                await timeHolder.deposit(asset1.address, DEPOSIT_AMOUNT1);
                await timeHolder.deposit(asset2.address, DEPOSIT_AMOUNT2);

                assert.equal(await timeHolder.getDepositBalance(asset1.address, accounts[0]), DEPOSIT_AMOUNT1);
                assert.equal(await timeHolder.getDepositBalance(asset2.address, accounts[0]), DEPOSIT_AMOUNT2);

                await timeHolder.denyShares([asset1.address, asset2.address]);

                assert.equal(await timeHolder.deposit.call(asset1.address, DEPOSIT_AMOUNT1), ErrorsEnum.UNAUTHORIZED);
                assert.equal(await timeHolder.deposit.call(asset2.address, DEPOSIT_AMOUNT2), ErrorsEnum.UNAUTHORIZED);
            });

            describe("ERC223 support", () => {
                const DEPOSIT_AMOUNT = 200;
                
                it("should allow to transfer ERC223 token and immediately deposit", async () => {
    
                    assert.equal(await timeHolder.getDepositBalance(shares.address, accounts[0]), 0);
                    assert.isTrue((await shares.transfer.call(timeHolder.address, DEPOSIT_AMOUNT, { from: accounts[0], })));
    
                    await shares.transfer(timeHolder.address, DEPOSIT_AMOUNT, { from: accounts[0], })
                    assert.equal(await timeHolder.getDepositBalance(shares.address, accounts[0]), DEPOSIT_AMOUNT);
                })

                it("timeholder wallet should support ERC223 token transfer", async () => {
                    assert.isTrue((await shares.transfer.call(timeHolderWallet, DEPOSIT_AMOUNT, { from: accounts[0], })));
                })

                it("rewards should NOT support ERC223 token transfer", async () => {
                    await shares.transfer.call(reward.address, DEPOSIT_AMOUNT, { from: accounts[0], }).then(assert.fail, () => true)
                })
            })

        })

        context("withdrawal with", () => {
            const user = accounts[1]
            const DEPOSIT_AMOUNT = 100

            it("and should have primary miner", async () => {
                assert.equal(await timeHolder.getPrimaryMiner.call(), miner)
            })

            context("success flow", () => {
                let initialBalance
                let initialMinerSharesBalance
                let initialMinerDepositBalance
                let initialMinerLockedBalance
                let initialWalletSharesBalance

                before(async () => {
                    await shares.approve(timeHolderWallet, UINT_MAX, { from: miner, })

                    initialBalance = await timeHolder.getDepositBalance.call(shares.address, user)
                    initialMinerSharesBalance = await shares.balanceOf(miner)
                    initialMinerDepositBalance = await timeHolder.getDepositBalance(shares.address, miner)
                    initialMinerLockedBalance = await timeHolder.getLockedDepositBalance(shares.address, miner)
                    initialWalletSharesBalance = await shares.balanceOf(timeHolderWallet)
                })

                after('revert', reverter.revert);

                it("should allow to deposit", async () => {
                    const tx = await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                    assert.equal(
                        (await timeHolder.getDepositBalance.call(shares.address, user)).toString(16),
                        initialBalance.plus(DEPOSIT_AMOUNT).toString(16)
                    )

                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "Deposit"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.who, user)
                        assert.equal(event.args.amount.toString(), DEPOSIT_AMOUNT.toString())
                    }
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "MinerDeposited"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.amount.toString(), DEPOSIT_AMOUNT.toString())
                        assert.equal(event.args.miner, miner)
                        assert.equal(event.args.sender, user)
                    }
                })

                it("miner should NOT receive deposited amount of shares", async () => {
                    assert.equal(
                        (await shares.balanceOf(miner)).toString(16),
                        initialMinerSharesBalance.toString(16)
                    )
                })
                
                it("miner should NOT receive deposit amount of shares", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance.call(shares.address, miner)).toString(16),
                        initialMinerDepositBalance.toString(16)
                    )
                })
                
                it("miner should receive additional locked balance in time holder", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance.call(shares.address, miner)).toString(16),
                        initialMinerLockedBalance.add(DEPOSIT_AMOUNT).toString(16)
                    )
                })

                it("reward wallet should receive deposited shares balance", async () => {
                    assert.equal(
                        (await shares.balanceOf(timeHolderWallet)).toString(),
                        initialWalletSharesBalance.add(DEPOSIT_AMOUNT).toString()
                    )
                })

                it("should NOT be able to withdraw for more amount than user has with TIMEHOLDER_INSUFFICIENT_BALANCE code", async () => {
                    const currentBalance = await timeHolder.getDepositBalance.call(shares.address, user)
                    assert.equal(
                        (await timeHolder.withdrawShares.call(shares.address, currentBalance.plus(1), { from: user, })).toString(),
                        ErrorsEnum.TIMEHOLDER_INSUFFICIENT_BALANCE
                    )
                })

                it("should be able to withdraw for less or equal amount as deposit balance with OK code", async () => {
                    const currentBalance = await timeHolder.getDepositBalance.call(shares.address, user)
                    assert.equal(
                        (await timeHolder.withdrawShares.call(shares.address, currentBalance, { from: user, })).toString(),
                        ErrorsEnum.OK
                    )
                })

                let withdrawalBalance

                it("should allow to withdraw", async () => {
                    withdrawalBalance = await timeHolder.getDepositBalance.call(shares.address, user)
                    const resolver = miner
                    const minerSharesBalance = await shares.balanceOf(resolver)
                    const userSharesBalance = await shares.balanceOf(user)
                    const tx = await timeHolder.withdrawShares(shares.address, withdrawalBalance, { from: user, })
                    
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "WithdrawShares"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.who, user)
                        assert.equal(event.args.amount, withdrawalBalance.toString())
                        assert.equal(event.args.receiver, user)
                    }

                    assert.equal(
                        (await shares.balanceOf(resolver)).toString(16),
                        minerSharesBalance.toString(16)
                    )
                    assert.equal(
                        (await shares.balanceOf(user)).toString(16),
                        userSharesBalance.add(withdrawalBalance).toString(16)
                    )
                    assert.equal(
                        (await shares.balanceOf(timeHolderWallet)).toString(16),
                        initialWalletSharesBalance.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getDepositBalance.call(shares.address, user)).toString(16),
                        initialBalance.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance.call(shares.address, miner)).toString(16),
                        initialMinerLockedBalance.toString(16)
                    )
                })
            })

            context("several deposits", () => {
                let initialBalance
                let initialAccountBalance

                before(async () => {
                    await shares.approve(timeHolderWallet, UINT_MAX, { from: miner, })

                    initialBalance = await timeHolder.getDepositBalance.call(shares.address, user)
                    initialAccountBalance = await shares.balanceOf(user)

                    await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user })
                    await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user })
                })

                after('revert', reverter.revert);

                let accountBalanceAfterDeposit
                let balanceAfterDeposit

                it("should transfer tokens from account's address", async () => {
                    accountBalanceAfterDeposit = await shares.balanceOf.call(user)
                    assert.equal(accountBalanceAfterDeposit.toString(), initialAccountBalance.sub(DEPOSIT_AMOUNT * 2).toString())
                })

                it("should have deposited tokens in TimeHolder", async () => {
                    balanceAfterDeposit = await timeHolder.getDepositBalance.call(shares.address, user)
                    assert.equal(balanceAfterDeposit.toString(), initialBalance.add(DEPOSIT_AMOUNT * 2).toString())
                })

                it("allow to withdraw some shares", async () => {
                    assert.equal((await _withdrawSharesCall(user, DEPOSIT_AMOUNT)).toNumber(), ErrorsEnum.OK)
                    await _withdrawShares(user, DEPOSIT_AMOUNT)
                })

                it("should have increased balance of tokens on an account address", async () => {
                    let accountBalanceAfterWithdrawal = await shares.balanceOf.call(user)
                    assert.equal(accountBalanceAfterWithdrawal.toString(), accountBalanceAfterDeposit.add(DEPOSIT_AMOUNT).toString())
                })

                it("should have reduced balance in TimeHolder", async () => {
                    let balanceAfterWithdrawal = await timeHolder.getDepositBalance.call(shares.address, user)
                    assert.equal(balanceAfterWithdrawal.toString(), balanceAfterDeposit.minus(DEPOSIT_AMOUNT).toString())
                })
            })

            context("emergency withdrawal", () => {
                const depositor = accounts[1]
                const contractOwner = accounts[0]
                const withdrawalAmount1 = DEPOSIT_AMOUNT / 2

                let initialBalance
                let totalDeposit

                before(async () => {
                    await shares.approve(timeHolderWallet, UINT_MAX, { from: miner, })

                    initialBalance = await timeHolder.getDepositBalance.call(shares.address, depositor)
                    totalDeposit = web3.toBigNumber(10*DEPOSIT_AMOUNT)
                    await timeHolder.deposit(shares.address, totalDeposit, { from: depositor, })
                })

                after('revert', reverter.revert)

                it("should NOT allow to force request withdrawal from non contract owner with UNAUTHORIZED code", async () => {
                    const stranger = accounts[3]
                    assert.equal(
                        (await timeHolder.forceWithdrawShares.call(depositor, shares.address, withdrawalAmount1, { from: stranger, })).toNumber(),
                        ErrorsEnum.UNAUTHORIZED
                    )
                })

                it("should allow force request withdrawal from contract owner with OK code", async () => {
                    assert.equal(
                        (await timeHolder.forceWithdrawShares.call(depositor, shares.address, withdrawalAmount1, { from: contractOwner, })).toNumber(),
                        ErrorsEnum.OK
                    )
                })

                it("should allow force withdrawal from contract owner", async () => {
                    const resolver = miner
                    const minerSharesBalance = await shares.balanceOf(resolver)
                    const initialMinerLockedBalance = await timeHolder.getLockedDepositBalance(shares.address, resolver)
                    const initialOwnerSharesBalance = await shares.balanceOf(contractOwner)
                    const initialOwnerDepositBalance = await timeHolder.getDepositBalance(shares.address, contractOwner)
                    const initialUserSharesBalance = await shares.balanceOf(depositor)
                    const tx = await timeHolder.forceWithdrawShares(depositor, shares.address, withdrawalAmount1, { from: contractOwner, })
                    
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "WithdrawShares"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.who, depositor)
                        assert.equal(event.args.amount, withdrawalAmount1.toString())
                        assert.equal(event.args.receiver, contractOwner)
                    }

                    assert.equal(
                        (await shares.balanceOf(contractOwner)).toString(16),
                        initialOwnerSharesBalance.add(withdrawalAmount1).toString(16)
                    )
                    assert.equal(
                        (await shares.balanceOf(depositor)).toString(16),
                        initialUserSharesBalance.toString(16)
                    )
                    assert.equal(
                        (await shares.balanceOf(resolver)).toString(16),
                        minerSharesBalance.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, resolver)).toString(16),
                        initialMinerLockedBalance.sub(withdrawalAmount1).toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, contractOwner)).toString(16),
                        initialOwnerDepositBalance.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, depositor)).toString(16),
                        initialBalance.add(totalDeposit).sub(withdrawalAmount1).toString(16)
                    )
                })
            })
        })

        context("locking deposits and becoming a miner", () => {
            const user = accounts[1]
            const DEPOSIT_AMOUNT = 100
            var contextSnapshotId

            context("without set up mining deposit limit", () => {

                before(async () => {
                    await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                })

                after('revert', reverter.revert);

                it("should have deposited balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        DEPOSIT_AMOUNT.toString(16)
                    )
                })

                it("should NOT allow to lock with TIMEHOLDER_INVALID_MINING_LIMIT code", async () => {
                    assert.equal(
                        (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, user, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_INVALID_MINING_LIMIT
                    )
                })

                it("should NOT allow to lock", async () => {
                    const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, user, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                        assert.isUndefined(event)
                    }
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                        assert.isUndefined(event)
                    }

                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        DEPOSIT_AMOUNT.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                })
            })
            
            context("with set up mining deposit limits", () => {
                const MINING_DEPOSIT_LIMITS = 150
                
                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })
                    contextSnapshotId = reverter.snapshotId
                    await reverter.promisifySnapshot()
                })

                after(async () => {
                    await reverter.promisifyRevert(contextSnapshotId)
                })

                it(`should have set up mining deposit limits = ${MINING_DEPOSIT_LIMITS}`, async () => {
                    assert.equal(
                        (await timeHolder.getMiningDepositLimits(shares.address)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })

                describe("and without enough deposit", () => {

                    before(async () => {
                        await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                    })
        
                    after('revert', reverter.revert);

                    it("should have deposited balance in TimeHolder", async () => {
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                    })

                    it("should NOT allow to lock with TIMEHOLDER_MINING_LIMIT_NOT_REACHED code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, user, { from: user, })).toNumber(),
                            ErrorsEnum.TIMEHOLDER_MINING_LIMIT_NOT_REACHED
                        )
                    })

                    it("should NOT allow to lock", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, user, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isUndefined(event)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isUndefined(event)
                        }
    
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            '0'
                        )
                    })

                })

                describe("and with enough deposit", () => {

                    before(async () => {
                        await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                    })
        
                    after('revert', reverter.revert);

                    it("should have deposited balance in TimeHolder", async () => {
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })

                    it("should allow to lock with OK code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, MINING_DEPOSIT_LIMITS, user, { from: user, })).toNumber(),
                            ErrorsEnum.OK
                        )
                    })

                    it("should allow to lock", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, MINING_DEPOSIT_LIMITS, user, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isDefined(event)
                            assert.equal(event.args.token, shares.address)
                            assert.equal(web3.toBigNumber(event.args.amount).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                            assert.equal(event.args.user, user)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isDefined(event)
                            assert.equal(event.args.token, shares.address)
                            assert.equal(event.args.miner, user)
                            assert.equal(web3.toBigNumber(event.args.totalDepositLocked).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                        }
    
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            '0'
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })

                    it("should allow to deposit more", async () => {
                        await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                    })

                    it("should NOT allow to lock more tokens with TIMEHOLDER_ALREADY_MINER code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, user, { from: user, })).toNumber(),
                            ErrorsEnum.TIMEHOLDER_ALREADY_MINER
                        )
                    })

                    it("should NOT allow to lock more tokens", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, user, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isUndefined(event)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isUndefined(event)
                        }

                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )    
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })
                })
            })
        })
        
        context("unlocking deposits and resigning a miner", () => {
            const MINING_DEPOSIT_LIMITS = 150
            const user = accounts[1]
            const DEPOSIT_AMOUNT = 100

            describe('with no locked deposits', () => {

                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })

                    await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                })

                after('revert', reverter.revert);

                it("should NOT have locked deposit balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'.toString(16)
                    )
                })

                it("should NOT be able to resign a miner with TIMEHOLDER_NOTHING_TO_UNLOCK code", async () => {
                    assert.equal(
                        (await timeHolder.unlockDepositAndResignMiner.call(shares.address, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_NOTHING_TO_UNLOCK
                    )
                })
                
                it("should NOT be able to resign a miner", async () => {
                    const tx = await timeHolder.unlockDepositAndResignMiner(shares.address, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "ResignMiner"))[0]
                        assert.isUndefined(event)
                    }
                })
                
                it("should NOT change deposited balance", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
            })
            
            describe("when already a miner", () => {
                
                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })
                    
                    await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                    await timeHolder.lockDepositAndBecomeMiner(shares.address, MINING_DEPOSIT_LIMITS, user, { from: user, })
                })
                
                after('revert', reverter.revert);
                
                it(`should have set up mining deposit limits = ${MINING_DEPOSIT_LIMITS}`, async () => {
                    assert.equal(
                        (await timeHolder.getMiningDepositLimits(shares.address)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
                
                it("should NOT have deposited balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                })
                
                it("should have locked deposit balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
    
                it("should allow to unlock deposited balance with OK code", async () => {
                    assert.equal(
                        (await timeHolder.unlockDepositAndResignMiner.call(shares.address, { from: user, })).toNumber(),
                        ErrorsEnum.OK
                    )
                })
    
                it("should allow to unlock deposited balance", async () => {
                    const tx = await timeHolder.unlockDepositAndResignMiner(shares.address, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "ResignMiner"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.miner, user)
                        assert.equal(web3.toBigNumber(event.args.depositUnlocked).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                    }
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                })
    
                it("should have its deposit back", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })

                it("should NOT be able to lock less then mining deposit limit when the deposit is unlocked with TIMEHOLDER_MINING_LIMIT_NOT_REACHED code", async () => {
                    assert.isAtLeast(MINING_DEPOSIT_LIMITS, DEPOSIT_AMOUNT)
                    assert.equal(
                        (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, user, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_MINING_LIMIT_NOT_REACHED
                    )
                })
            })
        })

        context("locking deposits for a delegate", () => {
            const user = accounts[1]
            const DEPOSIT_AMOUNT = 100
            const delegates = {
                delegate1: accounts[8],
                delegate2: accounts[9],
            }
            var contextSnapshotId
            
            context("without set up mining deposit limit", () => {

                before(async () => {
                    await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                })

                after('revert', reverter.revert);

                it("should have deposited balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        DEPOSIT_AMOUNT.toString(16)
                    )
                })
                
                it("should NOT have any locked deposited balance for a delegate", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                        '0',
                        "should not have deposit for delegate1"
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate2)).toString(16),
                        '0',
                        "should not have deposit for delegate2"
                    )
                    
                })

                it("should NOT allow to lock with TIMEHOLDER_INVALID_MINING_LIMIT code", async () => {
                    assert.equal(
                        (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_INVALID_MINING_LIMIT
                    )
                })

                it("should NOT allow to lock", async () => {
                    const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                        assert.isUndefined(event)
                    }
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                        assert.isUndefined(event)
                    }

                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        DEPOSIT_AMOUNT.toString(16)
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                        '0'
                    )
                })
            })
            
            context("with set up mining deposit limits", () => {
                const MINING_DEPOSIT_LIMITS = 150
                
                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })
                    contextSnapshotId = reverter.snapshotId
                    await reverter.promisifySnapshot()
                })

                after(async () => {
                    await reverter.promisifyRevert(contextSnapshotId)
                })

                it(`should have set up mining deposit limits = ${MINING_DEPOSIT_LIMITS}`, async () => {
                    assert.equal(
                        (await timeHolder.getMiningDepositLimits(shares.address)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })

                describe("and without enough deposit", () => {

                    before(async () => {
                        await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                    })
        
                    after('revert', reverter.revert);

                    it("should have deposited balance in TimeHolder", async () => {
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                    })

                    it("should NOT allow to lock with TIMEHOLDER_MINING_LIMIT_NOT_REACHED code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })).toNumber(),
                            ErrorsEnum.TIMEHOLDER_MINING_LIMIT_NOT_REACHED
                        )
                    })

                    it("should NOT allow to lock", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isUndefined(event)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isUndefined(event)
                        }
    
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            '0'
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                            '0'
                        )
                    })

                })

                describe("and with enough deposit", () => {

                    before(async () => {
                        await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                    })
        
                    after('revert', reverter.revert);

                    it("should have deposited balance in TimeHolder", async () => {
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })

                    it("should allow to lock with OK code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, MINING_DEPOSIT_LIMITS, delegates.delegate1, { from: user, })).toNumber(),
                            ErrorsEnum.OK
                        )
                    })

                    it("should allow to lock", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, MINING_DEPOSIT_LIMITS, delegates.delegate1, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isDefined(event)
                            assert.equal(event.args.token, shares.address)
                            assert.equal(web3.toBigNumber(event.args.amount).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                            assert.equal(event.args.user, user)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isDefined(event)
                            assert.equal(event.args.token, shares.address)
                            assert.equal(event.args.miner, delegates.delegate1)
                            assert.equal(web3.toBigNumber(event.args.totalDepositLocked).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                        }
    
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            '0'
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })

                    it("should allow to deposit more", async () => {
                        await timeHolder.deposit(shares.address, DEPOSIT_AMOUNT, { from: user, })
                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )
                    })

                    it("should NOT allow to lock more tokens with TIMEHOLDER_ALREADY_MINER code", async () => {
                        assert.equal(
                            (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })).toNumber(),
                            ErrorsEnum.TIMEHOLDER_ALREADY_MINER
                        )
                    })

                    it("should NOT allow to lock more tokens", async () => {
                        const tx = await timeHolder.lockDepositAndBecomeMiner(shares.address, DEPOSIT_AMOUNT, delegates.delegate1, { from: user, })
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "DepositLocked"))[0]
                            assert.isUndefined(event)
                        }
                        {
                            const event = (await eventsHelper.findEvent([timeHolder,], tx, "BecomeMiner"))[0]
                            assert.isUndefined(event)
                        }

                        assert.equal(
                            (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                            DEPOSIT_AMOUNT.toString(16)
                        )    
                        assert.equal(
                            (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                        assert.equal(
                            (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                            MINING_DEPOSIT_LIMITS.toString(16)
                        )
                    })
                })
            })
        })

        context("unlocking deposits for a delegate", () => {
            const MINING_DEPOSIT_LIMITS = 150
            const user = accounts[1]
            const DEPOSIT_AMOUNT = 100
            const delegates = {
                delegate1: accounts[8],
                delegate2: accounts[9],
            }

            describe('with no locked deposits', () => {

                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })

                    await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                })

                after('revert', reverter.revert);

                it("should NOT have locked deposit balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'.toString(16)
                    )
                })

                it("should NOT be able to resign a miner with TIMEHOLDER_NOTHING_TO_UNLOCK code", async () => {
                    assert.equal(
                        (await timeHolder.unlockDepositAndResignMiner.call(shares.address, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_NOTHING_TO_UNLOCK
                    )
                })
                
                it("should NOT be able to resign a miner", async () => {
                    const tx = await timeHolder.unlockDepositAndResignMiner(shares.address, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "ResignMiner"))[0]
                        assert.isUndefined(event)
                    }
                })
                
                it("should NOT change deposited balance", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
            })
            
            describe("when already a miner", () => {
                
                before(async () => {
                    await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })
                    
                    await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
                    await timeHolder.lockDepositAndBecomeMiner(shares.address, MINING_DEPOSIT_LIMITS, delegates.delegate1, { from: user, })
                })
                
                after('revert', reverter.revert);
                
                it(`should have set up mining deposit limits = ${MINING_DEPOSIT_LIMITS}`, async () => {
                    assert.equal(
                        (await timeHolder.getMiningDepositLimits(shares.address)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
                
                it("should NOT have deposited balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                })
                
                it("should have locked deposit balance in TimeHolder", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
                
                it("should have locked deposit balance for a delegate", async () => {
                    assert.equal(
                        (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })
    
                it("should allow to unlock deposited balance with OK code", async () => {
                    assert.equal(
                        (await timeHolder.unlockDepositAndResignMiner.call(shares.address, { from: user, })).toNumber(),
                        ErrorsEnum.OK
                    )
                })
    
                it("should allow to unlock deposited balance", async () => {
                    const tx = await timeHolder.unlockDepositAndResignMiner(shares.address, { from: user, })
                    {
                        const event = (await eventsHelper.findEvent([timeHolder,], tx, "ResignMiner"))[0]
                        assert.isDefined(event)
                        assert.equal(event.args.token, shares.address)
                        assert.equal(event.args.miner, user)
                        assert.equal(web3.toBigNumber(event.args.depositUnlocked).toString(16), MINING_DEPOSIT_LIMITS.toString(16))
                    }
                    assert.equal(
                        (await timeHolder.getLockedDepositBalance(shares.address, user)).toString(16),
                        '0'
                    )
                    assert.equal(
                        (await timeHolder.getLockedDepositBalanceForDelegate(shares.address, delegates.delegate1)).toString(16),
                        '0'
                    )
                })
    
                it("should have its deposit back", async () => {
                    assert.equal(
                        (await timeHolder.getDepositBalance(shares.address, user)).toString(16),
                        MINING_DEPOSIT_LIMITS.toString(16)
                    )
                })

                it("should NOT be able to lock less then mining deposit limit when the deposit is unlocked with TIMEHOLDER_MINING_LIMIT_NOT_REACHED code", async () => {
                    assert.isAtLeast(MINING_DEPOSIT_LIMITS, DEPOSIT_AMOUNT)
                    assert.equal(
                        (await timeHolder.lockDepositAndBecomeMiner.call(shares.address, DEPOSIT_AMOUNT, user, { from: user, })).toNumber(),
                        ErrorsEnum.TIMEHOLDER_MINING_LIMIT_NOT_REACHED
                    )
                })
            })
        })

        context("setup of primary miner", () => {
            const MINING_DEPOSIT_LIMITS = 150
            const user = accounts[1]
            const otherMiner = accounts[7]

            before(async () => {
                await timeHolder.setMiningDepositLimits(shares.address, MINING_DEPOSIT_LIMITS, { from: accounts[0], })
                await timeHolder.deposit(shares.address, MINING_DEPOSIT_LIMITS, { from: user, })
            })

            after(async () => {
                await reverter.promisifyRevert()
            })

            it("should have set up miner", async () => {
                assert.equal(
                    await timeHolder.getPrimaryMiner(),
                    miner
                )
            })

            it("miner should have locked balance", async () => {
                assert.equal(
                    (await timeHolder.getLockedDepositBalance(shares.address, miner)).toString(16),
                    MINING_DEPOSIT_LIMITS.toString(16)
                )
            })

            it("miner should NOT have locked balance", async () => {
                assert.equal(
                    (await timeHolder.getDepositBalance(shares.address, miner)).toString(16),
                    '0'
                )
            })

            it("miner should NOT be able to unlock locked balance with UNAUTHORIZED code", async () => {
                assert.equal(
                    (await timeHolder.unlockDepositAndResignMiner.call(shares.address, { from: miner, })).toString(16),
                    ErrorsEnum.UNAUTHORIZED.toString(16)
                )
            })

            it("miner should NOT be able to unlock locked balance", async () => {
                await timeHolder.unlockDepositAndResignMiner(shares.address, { from: miner, })
                assert.equal(
                    (await timeHolder.getDepositBalance(shares.address, miner)).toString(16),
                    '0'
                )
                assert.equal(
                    (await timeHolder.getLockedDepositBalance(shares.address, miner)).toString(16),
                    MINING_DEPOSIT_LIMITS.toString(16)
                )
            })

            it("should allow to change primary miner to contract owner", async () => {
                assert.equal(
                    (await timeHolder.setPrimaryMiner.call(otherMiner, { from: accounts[0], })).toString(16),
                    ErrorsEnum.OK.toString(16)
                )

                await timeHolder.setPrimaryMiner(otherMiner, { from: accounts[0], })
                assert.equal(
                    await timeHolder.getPrimaryMiner(),
                    otherMiner
                )
            })

            it("old miner should NOT have any locked balances nor deposits", async () => {
                assert.equal(
                    (await timeHolder.getLockedDepositBalance(shares.address, miner)).toString(16),
                    '0'
                )
                assert.equal(
                    (await timeHolder.getDepositBalance(shares.address, miner)).toString(16),
                    '0'
                )
            })

            it("new miner should have locked balance", async () => {
                assert.equal(
                    (await timeHolder.getLockedDepositBalance(shares.address, otherMiner)).toString(16),
                    MINING_DEPOSIT_LIMITS.toString(16)
                )
            })
        })
    })
});
