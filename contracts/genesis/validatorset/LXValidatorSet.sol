//! Copyright 2017 Peter Czaban, Parity Technologies Ltd.
//!
//! Licensed under the Apache License, Version 2.0 (the "License");
//! you may not use this file except in compliance with the License.
//! You may obtain a copy of the License at
//!
//!     http://www.apache.org/licenses/LICENSE-2.0
//!
//! Unless required by applicable law or agreed to in writing, software
//! distributed under the License is distributed on an "AS IS" BASIS,
//! WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//! See the License for the specific language governing permissions and
//! limitations under the License.

pragma solidity ^0.4.23;

import "solidity-shared-lib/contracts/Owned.sol";
import "../../common/BaseRouter.sol";
import "./IValidatorSet.sol";
import "../../validators/LXValidatorManager.sol";

// Owner can add or remove validators.

contract LXValidatorSet is Owned, IValidatorSet, BaseRouter {
    // EVENTS
    event Report(address indexed reporter, address indexed reported, bool indexed malicious);
    event ChangeFinalized(address[] current_set);

    uint public recentBlocks = 20;

    bool public finalized;
    address public backendAddress;
    address public systemAddress; // System address, used by the block sealer.

    modifier only_system_and_not_finalized() {
        require(msg.sender == systemAddress && !finalized);
        _;
    }

    modifier onlyFinalized() {
        require(finalized);
        _;
    }

    modifier onlyValidator(address _someone) {
        if (backendAddress != 0x0
            && LXValidatorManager(backendAddress).isValidator(_someone)) { _; }
    }

    modifier onlyRecent(uint _blockNumber) {
        require(block.number <= _blockNumber + recentBlocks);
        _;
    }

    modifier onlyBackend {
        require(msg.sender == backendAddress);
        _;
    }

    constructor(address _owner, address _system) public {
        require(_owner != 0x0);
        require(_system != 0x0);

        contractOwner = _owner;
        systemAddress = _system;
    }

    // Called to determine the current set of validators.
    function getValidators()
    external
    view
    returns (address[])
    {
        if (backendAddress != 0x0) {
            return LXValidatorManager(backendAddress).getValidators();
        }
    }

    function getPending()
    public
    view
    returns (address[])
    {
        if (backendAddress != 0x0) {
            return LXValidatorManager(backendAddress).getPending();
        }
    }

    // Log desire to change the current list.
    function initiateChange()
    public
    onlyBackend
    //onlyFinalized
    {
        finalized = false;
        emit InitiateChange(blockhash(block.number - 1), getPending());
    }

    function finalizeChange()
    external
    only_system_and_not_finalized
    {
        if (backendAddress != 0x0) {
            LXValidatorManager(backendAddress).finalizeChange();
        }

        finalized = true;
        emit ChangeFinalized(this.getValidators());
    }

    // MISBEHAVIOUR HANDLING

    // Called when a validator should be removed.
    function reportMalicious(address _validator, uint _blockNumber, bytes /*_proof*/)
    external
    onlyContractOwner
    onlyRecent(_blockNumber)
    {
        // TODO: ahiatsevich - proof is not used
        emit Report(msg.sender, _validator, true);
    }

    // Report that a validator has misbehaved in a benign way.
    function reportBenign(address _validator, uint _blockNumber)
    external
    onlyContractOwner
    onlyValidator(_validator)
    onlyRecent(_blockNumber)
    {
        emit Report(msg.sender, _validator, false);
    }

    // EXTEND DEFAULT FUNCTIONALITY

    function setRecentBlocks(uint _recentBlocks)
    public
    onlyContractOwner
    {
        recentBlocks = _recentBlocks;
    }

    function setBackend(address _backend)
    public
    onlyContractOwner
    {
        backendAddress = _backend;
    }

    function backend()
    internal
    view
    returns (address)
    {
        return backendAddress;
    }
}
