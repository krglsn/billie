// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 interface for pull payments.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Billie PermissionedResolver text reader (ENSv2-compatible).
interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/**
 * @title PaymentRouter
 * @notice Settles Billie invoices by reading ENS text records and pulling ERC-20.
 *
 * Invoice texts (on Billie's shared PermissionedResolver):
 *   billie.token            — ERC-20 address (0x…)
 *   billie.paymentAddress   — recipient address (0x…)
 *   billie.amount           — atomic units as decimal string
 *   billie.status           — must be "open"
 *   billie.invoiceId        — echoed in InvoicePaid
 *
 * Anti-double-pay: `paid[node]` is set before transferFrom.
 * Billie does not need a listener: status APIs eth_call `paid(node)`.
 */
contract PaymentRouter {
    error RouterUnauthorized();
    error RouterZeroAddress();
    error InvoiceNotPayable(string reason);
    error TransferFailed();

    event InvoicePaid(
        bytes32 indexed node,
        string invoiceId,
        address indexed payer,
        address token,
        address paymentAddress,
        uint256 amount
    );

    event InvoiceResolverUpdated(address indexed resolver);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address public owner;
    ITextResolver public invoiceResolver;
    mapping(bytes32 => bool) public paid;

    modifier onlyOwner() {
        if (msg.sender != owner) revert RouterUnauthorized();
        _;
    }

    constructor(address invoiceResolver_) {
        if (invoiceResolver_ == address(0)) revert RouterZeroAddress();
        owner = msg.sender;
        invoiceResolver = ITextResolver(invoiceResolver_);
        emit OwnershipTransferred(address(0), msg.sender);
        emit InvoiceResolverUpdated(invoiceResolver_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert RouterZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setInvoiceResolver(address invoiceResolver_) external onlyOwner {
        if (invoiceResolver_ == address(0)) revert RouterZeroAddress();
        invoiceResolver = ITextResolver(invoiceResolver_);
        emit InvoiceResolverUpdated(invoiceResolver_);
    }

    /// @notice View helper for UI / Billie status APIs.
    function checkInvoice(bytes32 node)
        external
        view
        returns (
            bool payable_,
            address token,
            address paymentAddress,
            uint256 amount,
            string memory status,
            string memory reason
        )
    {
        return _checkInvoice(node);
    }

    function payInvoice(bytes32 node) external {
        (
            bool payable_,
            address token,
            address paymentAddress,
            uint256 amount,
            ,
            string memory reason
        ) = _checkInvoice(node);
        if (!payable_) revert InvoiceNotPayable(reason);

        // Effects before interactions
        paid[node] = true;

        string memory invoiceId = invoiceResolver.text(node, "billie.invoiceId");

        bool ok = IERC20(token).transferFrom(msg.sender, paymentAddress, amount);
        if (!ok) revert TransferFailed();

        emit InvoicePaid(node, invoiceId, msg.sender, token, paymentAddress, amount);
    }

    function _checkInvoice(bytes32 node)
        internal
        view
        returns (
            bool payable_,
            address token,
            address paymentAddress,
            uint256 amount,
            string memory status,
            string memory reason
        )
    {
        if (paid[node]) {
            return (false, address(0), address(0), 0, "", "already_paid");
        }

        status = invoiceResolver.text(node, "billie.status");
        if (!_eq(status, "open")) {
            return (false, address(0), address(0), 0, status, "not_open");
        }

        string memory tokenStr = invoiceResolver.text(node, "billie.token");
        string memory payeeStr = invoiceResolver.text(node, "billie.paymentAddress");
        string memory amountStr = invoiceResolver.text(node, "billie.amount");

        if (bytes(tokenStr).length == 0) {
            return (false, address(0), address(0), 0, status, "missing_token");
        }
        if (bytes(payeeStr).length == 0) {
            return (false, address(0), address(0), 0, status, "missing_payment_address");
        }
        if (bytes(amountStr).length == 0) {
            return (false, address(0), address(0), 0, status, "missing_amount");
        }

        token = _parseAddress(tokenStr);
        if (token == address(0)) {
            return (false, address(0), address(0), 0, status, "bad_token");
        }

        paymentAddress = _parseAddress(payeeStr);
        if (paymentAddress == address(0)) {
            return (false, address(0), address(0), 0, status, "bad_payment_address");
        }

        amount = _parseUint(amountStr);
        if (amount == 0) {
            return (false, token, paymentAddress, 0, status, "bad_amount");
        }

        return (true, token, paymentAddress, amount, status, "");
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev Accepts 0x-prefixed 40-hex-char addresses (case-insensitive).
    function _parseAddress(string memory s) private pure returns (address) {
        bytes memory b = bytes(s);
        if (b.length != 42) return address(0);
        if (b[0] != "0" || (b[1] != "x" && b[1] != "X")) return address(0);

        uint256 result;
        for (uint256 i = 2; i < 42; i++) {
            uint8 c = uint8(b[i]);
            uint8 v;
            if (c >= uint8(bytes1("0")) && c <= uint8(bytes1("9"))) {
                v = c - uint8(bytes1("0"));
            } else if (c >= uint8(bytes1("a")) && c <= uint8(bytes1("f"))) {
                v = 10 + c - uint8(bytes1("a"));
            } else if (c >= uint8(bytes1("A")) && c <= uint8(bytes1("F"))) {
                v = 10 + c - uint8(bytes1("A"));
            } else {
                return address(0);
            }
            result = (result << 4) | v;
        }
        return address(uint160(result));
    }

    /// @dev Decimal string → uint256; empty / non-digit → 0.
    function _parseUint(string memory s) private pure returns (uint256) {
        bytes memory b = bytes(s);
        if (b.length == 0) return 0;
        uint256 result;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < uint8(bytes1("0")) || c > uint8(bytes1("9"))) return 0;
            result = result * 10 + (c - uint8(bytes1("0")));
        }
        return result;
    }
}
