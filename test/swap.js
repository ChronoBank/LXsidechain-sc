const AtomicSwapERC20 = artifacts.require('./AtomicSwapERC20.sol');
const ChronobankPlatform = artifacts.require('./ChronoBankPlatform.sol');
const ERC20 = artifacts.require('ERC20Interface');

// const utils = require('./helpers/utils');
const Reverter = require('./helpers/reverter');
// const bytes32 = require("./helpers/bytes32");
const sha256 = require("sha256");

contract('AtomicSwapERC20', function (accounts) {
    let reverter = new Reverter(web3);
    const middleware = accounts[1];
    const user = accounts[2];

    const SYMBOL = 'TIME';

    let platform;

    afterEach('revert', reverter.revert);

    before('before', async () => {
        platform = await ChronobankPlatform.deployed();
        await platform.addAssetPartOwner(SYMBOL, middleware);

        await reverter.promisifySnapshot();
    })

    context("Swap", async () => {
        it('mainnet -> sidechain', async () => {
            const secretKey = "Lorem ipsum dolor sit amet";
            const swapId = "test_swap_id";
            const value = 10;

            const tokenAddress = await platform.proxies(SYMBOL);
            const token = ERC20.at(tokenAddress);

            assert.isTrue((await token.balanceOf(user)).isZero());

            let swapContract = await AtomicSwapERC20.deployed();

            await platform.reissueAsset(SYMBOL, value, {from: middleware});
            await ERC20.at(tokenAddress).approve(swapContract.address, value, {from: middleware});

            assert.isTrue((await token.balanceOf(middleware)).eq(value));
            assert.isTrue((await token.allowance(middleware, swapContract.address)).eq(value));

            const secretKeyHash = "0x" + sha256(secretKey);
            await swapContract.open(swapId, value, tokenAddress, user, secretKeyHash, (new Date()).getTime()/1000 + 120, {from: middleware});

            assert.isTrue((await token.balanceOf(user)).isZero());
            assert.isTrue((await token.balanceOf(swapContract.address)).eq(value));

            await swapContract.close(swapId, secretKey, {from: user});
            assert.isTrue((await token.balanceOf(user)).eq(value));
            assert.isTrue((await token.balanceOf(swapContract.address)).isZero());
        })
    });
});
