// This file is auto-generated. Do not edit.
#pragma once

#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/STParsedJSON.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/protocol_autogen/TransactionBase.h>
#include <xrpl/protocol_autogen/TransactionBuilderBase.h>
#include <xrpl/json/json_value.h>

#include <stdexcept>
#include <optional>

namespace xrpl::transactions {

class SigningSessionDeleteBuilder;

/**
 * @brief Transaction: SigningSessionDelete
 *
 * Type: ttSIGNING_SESSION_DELETE (131)
 * Delegable: Delegation::NotDelegable
 * Amendment: featureSigningSessions
 * Privileges: Privilege::NoPriv
 *
 * Immutable wrapper around STTx providing type-safe field access.
 * Use SigningSessionDeleteBuilder to construct new transactions.
 */
class SigningSessionDelete : public TransactionBase
{
public:
    static constexpr xrpl::TxType txType = ttSIGNING_SESSION_DELETE;

    /**
     * @brief Construct a SigningSessionDelete transaction wrapper from an existing STTx object.
     * @throws std::runtime_error if the transaction type doesn't match.
     */
    explicit SigningSessionDelete(std::shared_ptr<STTx const> tx)
        : TransactionBase(std::move(tx))
    {
        // Verify transaction type
        if (tx_->getTxnType() != txType)
        {
            throw std::runtime_error("Invalid transaction type for SigningSessionDelete");
        }
    }

    // Transaction-specific field getters

    /**
     * @brief Get sfSessionKey (SoeRequired)
     * @return The field value.
     */
    [[nodiscard]]
    SF_ACCOUNT::type::value_type
    getSessionKey() const
    {
        return this->tx_->at(sfSessionKey);
    }

    /**
     * @brief Get sfOwner (SoeOptional)
     * @return The field value, or std::nullopt if not present.
     */
    [[nodiscard]]
    protocol_autogen::Optional<SF_ACCOUNT::type::value_type>
    getOwner() const
    {
        if (hasOwner())
        {
            return this->tx_->at(sfOwner);
        }
        return std::nullopt;
    }

    /**
     * @brief Check if sfOwner is present.
     * @return True if the field is present, false otherwise.
     */
    [[nodiscard]]
    bool
    hasOwner() const
    {
        return this->tx_->isFieldPresent(sfOwner);
    }
};

/**
 * @brief Builder for SigningSessionDelete transactions.
 *
 * Provides a fluent interface for constructing transactions with method chaining.
 * Uses STObject internally for flexible transaction construction.
 * Inherits common field setters from TransactionBuilderBase.
 */
class SigningSessionDeleteBuilder : public TransactionBuilderBase<SigningSessionDeleteBuilder>
{
public:
    /**
     * @brief Construct a new SigningSessionDeleteBuilder with required fields.
     * @param account The account initiating the transaction.
     * @param sessionKey The sfSessionKey field value.
     * @param sequence Optional sequence number for the transaction.
     * @param fee Optional fee for the transaction.
     */
    SigningSessionDeleteBuilder(SF_ACCOUNT::type::value_type account,
                     std::decay_t<typename SF_ACCOUNT::type::value_type> const& sessionKey,                    std::optional<SF_UINT32::type::value_type> sequence = std::nullopt,
                    std::optional<SF_AMOUNT::type::value_type> fee = std::nullopt
)
        : TransactionBuilderBase<SigningSessionDeleteBuilder>(ttSIGNING_SESSION_DELETE, account, sequence, fee)
    {
        setSessionKey(sessionKey);
    }

    /**
     * @brief Construct a SigningSessionDeleteBuilder from an existing STTx object.
     * @param tx The existing transaction to copy from.
     * @throws std::runtime_error if the transaction type doesn't match.
     */
    SigningSessionDeleteBuilder(std::shared_ptr<STTx const> tx)
    {
        if (tx->getTxnType() != ttSIGNING_SESSION_DELETE)
        {
            throw std::runtime_error("Invalid transaction type for SigningSessionDeleteBuilder");
        }
        object_ = *tx;
    }

    /**
     * @brief Transaction-specific field setters
     */

    /**
     * @brief Set sfSessionKey (SoeRequired)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionDeleteBuilder&
    setSessionKey(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfSessionKey] = value;
        return *this;
    }

    /**
     * @brief Set sfOwner (SoeOptional)
     * @return Reference to this builder for method chaining.
     */
    SigningSessionDeleteBuilder&
    setOwner(std::decay_t<typename SF_ACCOUNT::type::value_type> const& value)
    {
        object_[sfOwner] = value;
        return *this;
    }

    /**
     * @brief Build and return the SigningSessionDelete wrapper.
     * @param publicKey The public key for signing.
     * @param secretKey The secret key for signing.
     * @return The constructed transaction wrapper.
     */
    SigningSessionDelete
    build(PublicKey const& publicKey, SecretKey const& secretKey)
    {
        sign(publicKey, secretKey);
        return SigningSessionDelete{std::make_shared<STTx>(std::move(object_))};
    }
};

}  // namespace xrpl::transactions
