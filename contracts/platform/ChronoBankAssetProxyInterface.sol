/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 */

pragma solidity ^0.4.11;

import { ERC20Interface as ERC20 } from "solidity-shared-lib/contracts/ERC20Interface.sol";

contract ChronoBankAssetProxyInterface is ERC20 {
    address public chronoBankPlatform;
    bytes32 public smbl;
    function __transferWithReference(address _to, uint _value, string _reference, address _sender) public returns (bool);
    function __transferFromWithReference(address _from, address _to, uint _value, string _reference, address _sender) public returns (bool);
    function __approve(address _spender, uint _value, address _sender) public returns (bool);
    function getLatestVersion() public view returns (address);
    function getVersionFor(address _sender) public view returns (address);
    function init(address _chronoBankPlatform, string _symbol, string _name) public;
    function proposeUpgrade(address _newVersion) external returns (bool);
}
